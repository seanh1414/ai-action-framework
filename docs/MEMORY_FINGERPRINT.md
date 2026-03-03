# Memory Fingerprinting: Context-Aware Security for AI Agents

**Author:** [Sean Hussey](https://www.linkedin.com/in/seanphussey/)
**Date:** March 2026
**Status:** Design concept, open for collaboration
**License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Free to use, adapt, and build on with attribution.

---

## The problem

An AI agent queries a customer database. Now PII is in the LLM's context window. The agent then decides it needs to search the web to finish answering the user's question. That web request could carry sensitive data in its payload.

Nothing in the current ecosystem prevents this.

- **MCP** (Model Context Protocol) authenticates users and describes tools, but doesn't track what's in the LLM's context.
- **Cloud guardrails** (AWS Bedrock, Azure AI Foundry, Google Vertex) filter content and enforce IAM, but authorize based on who the user is, not on what sensitive data has accumulated in the session.
- **Security products** (Lakera, NeMo Guardrails, LLM Guard, Lasso MCP Gateway) scan individual inputs and outputs for PII and prompt injection. They don't know what the agent read three tool calls ago.
- **The AARM paper** (Autonomous Action Runtime Management, Feb 2026) proposes session context accumulation for policy evaluation, but stays at the specification level.

The gap: **nobody is tracking what types of sensitive data have entered the LLM's context window and using that to dynamically gate what the agent can do next.**

---

## The idea

Instead of scanning every payload in real-time, introduce a lightweight metadata layer that tracks sensitivity state per session.

### How it works

1. An agent calls a tool and gets data back.
2. The orchestration engine classifies the sensitivity of that response (PII? financial data? confidential?).
3. A **fingerprint** is registered: just metadata tags with a TTL. Not the data itself.

```json
{
  "id": "fpr_123456",
  "session_id": "session-abc123",
  "source_tool_id": "customer_db_query",
  "tags": ["pii", "financial"],
  "data_class": "confidential",
  "expires_at": "2025-11-16T14:25:02Z"
}
```

4. On every subsequent tool call in that session, the policy layer checks accumulated fingerprints. If `pii` is tagged and the next tool is an outbound web call, the policy can deny it, require payload scrubbing, or flag it for human review.
5. Fingerprints expire with TTLs, so sensitivity state decays naturally as context rotates.

### Why this approach

- **The model still gets the data it needs.** Fingerprinting doesn't cripple the LLM. It still receives raw data to do its work. The fingerprint layer only stores metadata about what *categories* of sensitive data are in play.
- **Decisions are fast.** Checking tags in a cache is orders of magnitude faster than running DLP regex against every tool call payload.
- **Sensitivity accumulates realistically.** A session that queried a customer database and then a financial API has a different risk profile than one that only checked the weather. The fingerprint state reflects that.
- **It's composable.** The cache is a simple key-value store with TTLs. It doesn't require changes to the LLM, the tools, or the protocol. It sits alongside them.

---

## How it fits into an agent loop

Any agentic system has some version of this loop: discover tools, let the LLM pick one, call it, feed the result back, repeat. Memory fingerprinting adds two steps to the tool-call path:

**Standard agentic loop:**
1. Discover available tools
2. LLM decides next action
3. If tool call: execute the tool, feed result back to LLM, repeat
4. If needs user input: ask the user a clarifying question
5. If done: return the answer

**With fingerprinting:**
1. Discover available tools
2. LLM decides next action
3. If tool call:
   - **Check fingerprints** for this session
   - **Evaluate policy**: user scopes + tool sensitivity metadata + accumulated fingerprints
   - If denied: feed denial reason back to LLM (it can try a different approach)
   - If allowed: execute the tool
   - **Register fingerprint** based on the tool's declared sensitivity and response content
   - Feed result back to LLM, repeat
4. If needs user input: ask the user a clarifying question
5. If done: optionally run content moderation, then return

The bold steps are the only additions. The rest of the loop is unchanged. This works with any agentic framework: LangChain, LlamaIndex, MCP-based systems, or custom implementations.

---

## Policy examples

Rules are simple conditionals over fingerprint state and tool metadata:

```yaml
rules:
  - id: pii_blocks_web
    if:
      fingerprints.tags.contains: pii
      tool.category: web
    then:
      decision: deny
      reason: pii_in_memory_blocks_web

  - id: confidential_requires_scrubbing
    if:
      fingerprints.data_class.in: [confidential, highly_confidential]
      tool.is_external: true
    then:
      decision: allow_with_requirements
      required_actions: [exfil_scrub]

  - id: high_risk_requires_approval
    if:
      tool.requires_human_approval: true
    then:
      decision: deny
      reason: approval_required
```

A user might have full permission to use a web search tool. But if PII entered the session two tool calls ago and the fingerprint hasn't expired, the policy blocks the web call. The authorization decision is based on accumulated context, not just static roles.

---

## Tool sensitivity metadata

For fingerprinting to work, tools need to declare their sensitivity characteristics at registration time. This is a small extension to any tool descriptor format (MCP tool definitions, OpenAI function schemas, custom registries):

```json
{
  "id": "customer_db_query",
  "description": "Query customer account information.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" }
    }
  },
  "sensitivity": {
    "data_class": "confidential",
    "output_tags": ["pii"],
    "allow_exfiltration": false,
    "requires_human_approval": false
  }
}
```

The `sensitivity` block tells the engine: when this tool returns data, register a fingerprint with `data_class: confidential` and tag `pii`. The engine doesn't need to inspect the actual response content (though it can, as a defense-in-depth layer). The tool's own declaration provides the baseline.

In MCP terms, this could be implemented as a new tool annotation alongside the existing `readOnlyHint` and `destructiveHint`, something like `sensitivityHint` with structured data classification metadata.

---

## How it works with off-the-shelf tools

Memory fingerprinting is not a platform. It's a thin layer (a cache and two hooks) that plugs into existing infrastructure:

| Component | What to use | Role in fingerprinting |
|---|---|---|
| **Fingerprint cache** | Redis, DynamoDB, or any key-value store with TTL support | Stores per-session sensitivity tags. This is the new piece. A few hundred lines of code. |
| **Policy engine** | [Cerbos](https://www.cerbos.dev/) (open source), [AWS Cedar](https://www.cedarpolicy.com/), or OPA | Evaluates rules against fingerprint state + tool metadata. Add a custom condition type that queries the cache. |
| **PII/sensitivity detection** | [Protect AI LLM Guard](https://github.com/protectai/llm-guard), [Lakera Guard](https://www.lakera.ai/), AWS Comprehend | Optional defense-in-depth: classify tool responses to validate or supplement the tool's declared sensitivity. |
| **Payload scrubbing** | LLM Guard, Lakera, [NeMo Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) | When policy says "allow with scrubbing," use an existing scrubber to redact the outbound payload. |
| **Content moderation** | NeMo Guardrails, Azure Content Safety, Bedrock Guardrails | Gate final LLM output. Existing products handle this well. |
| **Tool registry** | MCP server registry, any service catalog | Extend tool descriptors with a `sensitivity` block. No changes to the registry itself. |
| **Orchestration loop** | Any agentic framework (LangChain, LlamaIndex, custom) | Add two steps to the tool-call path: check fingerprints before, register fingerprint after. |

You don't need to build a new security platform. You need a cache, a policy engine, and two hooks in your existing agent loop. Everything else is glue to tools that already exist.

---

## What already exists (and what doesn't)

I surveyed the landscape before writing this. Here's what I found:

**Close but not the same:**

| What exists | How it differs from memory fingerprinting |
|---|---|
| **Lasso MCP Gateway** (DLP, monitoring, intent-aware policies for MCP tool calls) | Monitors inter-tool data movements but doesn't maintain an explicit per-session sensitivity cache with tags and TTLs |
| **TrustLogix TrustAI** (per-tool-call policy evaluation) | Policies based on user + tool, not on accumulated memory state |
| **Securiti Agent Commander** (data sensitivity mapping + policy enforcement) | Operates at the enterprise data platform level, not as a lightweight per-session metadata cache |
| **Open Edison** (tracks "private data + untrusted content + external communication") | Recognizes the same threat pattern but doesn't formalize it as a tag-based cache |
| **AARM paper (Feb 2026)** (proposes session context accumulation for policy evaluation) | Specification-level, doesn't describe the concrete fingerprint abstraction with TTLs and tags |
| **MCP tool annotations** (`readOnlyHint`, `destructiveHint`) | Explicitly "untrusted hints," not enforceable. No sensitivity/data-class metadata. |
| **AWS Bedrock / Azure AI / Google Vertex guardrails** (content filtering, PII detection, IAM-based auth) | Authorize based on user identity and tool permissions, not on what sensitive data has accumulated in the agent's context |

**The specific gap:** An explicit, lightweight, per-session metadata cache that tracks what categories of sensitive data have entered the LLM's context, uses tags with TTLs, and dynamically gates tool calls based on accumulated state. I haven't found this in any shipping product, open source project, or published paper.

If I'm wrong and someone has built this, I'd genuinely like to know.

---

## How this maps to today's standards (2026)

Memory fingerprinting isn't a concept that requires new protocols or platforms. It plugs directly into the standards, specs, and tools that exist right now.

### MCP (Model Context Protocol, spec version 2025-11-25)

The MCP spec already has a `_meta` field on tool definitions that accepts arbitrary key-value pairs. Sensitivity metadata can be attached today without any spec changes:

```json
{
  "name": "customer_db_query",
  "description": "Query customer account information.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" }
    },
    "required": ["query"]
  },
  "annotations": {
    "readOnlyHint": true,
    "openWorldHint": false
  },
  "_meta": {
    "sensitivity": {
      "data_class": "confidential",
      "output_tags": ["pii"],
      "allow_exfiltration": false
    }
  }
}
```

The existing annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) describe *what the tool does*. The `_meta.sensitivity` block describes *what kind of data comes back*. That's the missing dimension. A future MCP annotation like `sensitivityHint` could formalize this, but you don't have to wait for that. `_meta` works today.

**Important caveat:** MCP annotations are explicitly "untrusted hints." Memory fingerprinting doesn't rely on them for security. It uses them as *input* to a separate, trusted policy engine. The policy engine (Cerbos, Cedar, etc.) is the enforcement point, not MCP.

### OWASP Agentic AI Top 10 (December 2025)

**ASI06 (Memory & Context Poisoning)** is directly relevant. OWASP defines it as "injection or leakage of agent memory or contextual state that influences future reasoning or actions." Their recommended mitigations map cleanly to fingerprinting:

| OWASP ASI06 Mitigation | How fingerprinting implements it |
|---|---|
| **Provenance tracking** (every memory entry must be traceable to a source) | Fingerprints record `source_tool_id`, timestamp, and the tool chain that produced them |
| **Temporal decay** (memory entries lose trust weight over time, stale entries are purged) | Redis TTLs on fingerprint entries; sensitivity state expires automatically |
| **Context isolation** (per-session boundaries) | Per-session Redis keys; one session's fingerprints cannot affect another |
| **Governance layer** (dedicated enforcement between agents and tools) | Cerbos policy evaluation as middleware between the LLM and tool execution |
| **Input validation gating** (gate tool outputs that pass external content to context) | `wrap_tool_call` middleware checks fingerprints before allowing tool execution |
| **Behavioral monitoring** (detect shifts in tool usage patterns) | Cumulative sensitivity scoring per session flags anomalous tool chains |

### NIST AI Agent Standards Initiative (February 2026)

NIST has two open calls for input:
- **Request for Information on AI Agent Security** (due March 2026)
- **AI Agent Identity and Authorization Concept Paper** (due April 2026)

Memory fingerprinting addresses a gap that both calls target: runtime authorization that goes beyond static identity and role checks. The concept of "authorization decisions conditioned on accumulated context sensitivity" is exactly the kind of concrete mechanism these calls are looking for.

### LangChain middleware (current)

LangChain's `wrap_tool_call` middleware is the officially supported way to intercept tool execution. It gives you a pre/post hook around every tool call, which is exactly what fingerprinting needs:

```python
from langchain.agents.middleware import wrap_tool_call

@wrap_tool_call
def fingerprint_guard(request, handler):
    # PRE: check fingerprint cache, evaluate policy
    # ...if denied, return error without calling handler

    result = handler(request)  # execute the tool

    # POST: classify response sensitivity, register fingerprint
    return result
```

This is the integration point. Two hooks, one middleware function, plugged into any LangGraph agent.

---

## Sample implementation

This is a minimal but functional implementation of memory fingerprinting using Redis, Cerbos, and LangChain middleware. It's meant to show how little code the core idea actually requires.

### The fingerprint cache (Redis)

```python
import redis.asyncio as aioredis
import json
import time
from dataclasses import dataclass, asdict

@dataclass
class Fingerprint:
    session_id: str
    source_tool_id: str
    tags: list[str]          # e.g. ["pii", "financial"]
    data_class: str          # e.g. "confidential", "public"
    created_at: float

class FingerprintCache:
    """Per-session sensitivity tracking with TTLs."""

    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = aioredis.from_url(redis_url, decode_responses=True)

    async def register(self, fp: Fingerprint, ttl_seconds: int = 1200):
        """Register a fingerprint after a tool returns sensitive data."""
        key = f"fingerprints:{fp.session_id}"
        entry = asdict(fp)

        # Append to the session's fingerprint list
        await self.redis.rpush(key, json.dumps(entry))

        # Set/refresh TTL on the whole session key
        await self.redis.expire(key, ttl_seconds)

    async def get_active(self, session_id: str) -> list[Fingerprint]:
        """Get all active fingerprints for a session."""
        key = f"fingerprints:{session_id}"
        entries = await self.redis.lrange(key, 0, -1)
        return [
            Fingerprint(**json.loads(e))
            for e in entries
        ]

    async def get_active_tags(self, session_id: str) -> set[str]:
        """Get the union of all active sensitivity tags for a session."""
        fingerprints = await self.get_active(session_id)
        tags = set()
        for fp in fingerprints:
            tags.update(fp.tags)
        return tags

    async def get_highest_data_class(self, session_id: str) -> str:
        """Get the highest active data classification."""
        ranking = {"public": 0, "internal": 1, "confidential": 2,
                   "highly_confidential": 3}
        fingerprints = await self.get_active(session_id)
        if not fingerprints:
            return "public"
        return max(
            (fp.data_class for fp in fingerprints),
            key=lambda dc: ranking.get(dc, 0)
        )

    async def clear_session(self, session_id: str):
        """Clear all fingerprints for a session."""
        await self.redis.delete(f"fingerprints:{session_id}")
```

### The policy check (Cerbos)

```python
from cerbos.sdk.grpc.client import AsyncCerbosClient
from cerbos.engine.v1 import engine_pb2
from google.protobuf.struct_pb2 import Value

# Tool sensitivity declarations. In production, these come from
# the tool registry (MCP _meta, DynamoDB, etc.)
TOOL_SENSITIVITY = {
    "customer_db_query": {
        "data_class": "confidential",
        "output_tags": ["pii"],
        "is_external": False,
    },
    "web_search": {
        "data_class": "public",
        "output_tags": [],
        "is_external": True,
    },
    "weather_api": {
        "data_class": "public",
        "output_tags": [],
        "is_external": True,
    },
}

async def check_tool_allowed(
    session_id: str,
    tool_name: str,
    active_tags: set[str],
    highest_data_class: str,
    cerbos_url: str = "localhost:3593",
) -> tuple[bool, str]:
    """Check if a tool call is allowed given current fingerprint state."""

    tool_meta = TOOL_SENSITIVITY.get(tool_name, {})

    principal = engine_pb2.Principal(
        id=f"session:{session_id}",
        roles={"ai_agent"},
        attr={
            "session_id": Value(string_value=session_id),
            "active_tags": Value(string_value=",".join(active_tags)),
            "has_pii": Value(bool_value="pii" in active_tags),
            "has_financial": Value(bool_value="financial" in active_tags),
            "highest_data_class": Value(string_value=highest_data_class),
        },
    )

    resource = engine_pb2.Resource(
        id=f"tool:{tool_name}",
        kind="agent_tool",
        attr={
            "tool_name": Value(string_value=tool_name),
            "is_external": Value(bool_value=tool_meta.get("is_external", False)),
            "data_class": Value(string_value=tool_meta.get("data_class", "public")),
        },
    )

    async with AsyncCerbosClient(cerbos_url, tls_verify=False) as client:
        allowed = await client.is_allowed("invoke", principal, resource)
        reason = "allowed" if allowed else "denied_by_policy"
        return allowed, reason
```

### Cerbos policy (YAML)

This is the policy file that Cerbos evaluates. It encodes the fingerprint-aware rules:

```yaml
# policies/agent_tool.yaml
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: "agent_tool"
  version: "default"
  rules:
    # Block external tools when PII is in session memory
    - actions: ["invoke"]
      effect: EFFECT_DENY
      roles: ["ai_agent"]
      name: "pii_blocks_external"
      condition:
        match:
          all:
            of:
              - expr: P.attr.has_pii == true
              - expr: R.attr.is_external == true

    # Block external tools when confidential data is in session
    - actions: ["invoke"]
      effect: EFFECT_DENY
      roles: ["ai_agent"]
      name: "confidential_blocks_external"
      condition:
        match:
          all:
            of:
              - expr: P.attr.highest_data_class == "highly_confidential"
              - expr: R.attr.is_external == true

    # Allow everything else
    - actions: ["invoke"]
      effect: EFFECT_ALLOW
      roles: ["ai_agent"]
      name: "default_allow"
```

### The middleware (LangChain)

This ties it all together. One middleware function that wraps every tool call:

```python
import time
from langchain.agents.middleware import wrap_tool_call
from langchain.tools.tool_node import ToolCallRequest
from langchain.messages import ToolMessage

# Assumes these are initialized elsewhere
cache = FingerprintCache()
SESSION_ID = "current-session-id"  # in practice, from request context

@wrap_tool_call
async def fingerprint_guard(request: ToolCallRequest, handler):
    tool_name = request.tool_call["name"]

    # --- PRE-EXECUTION: check fingerprints, evaluate policy ---

    active_tags = await cache.get_active_tags(SESSION_ID)
    highest_class = await cache.get_highest_data_class(SESSION_ID)

    allowed, reason = await check_tool_allowed(
        session_id=SESSION_ID,
        tool_name=tool_name,
        active_tags=active_tags,
        highest_data_class=highest_class,
    )

    if not allowed:
        # Return denial to the LLM so it can try a different approach
        return ToolMessage(
            content=f"Tool '{tool_name}' blocked by policy: {reason}. "
                    f"Active sensitivity tags in session: {active_tags}. "
                    f"Try a different approach that doesn't require external access.",
            tool_call_id=request.tool_call["id"],
        )

    # --- EXECUTE THE TOOL ---

    result = await handler(request)

    # --- POST-EXECUTION: register fingerprint ---

    tool_meta = TOOL_SENSITIVITY.get(tool_name, {})
    output_tags = tool_meta.get("output_tags", [])
    data_class = tool_meta.get("data_class", "public")

    if output_tags:  # only fingerprint if the tool produces sensitive data
        fp = Fingerprint(
            session_id=SESSION_ID,
            source_tool_id=tool_name,
            tags=output_tags,
            data_class=data_class,
            created_at=time.time(),
        )
        await cache.register(fp, ttl_seconds=1200)  # 20 min TTL

    return result
```

### What happens at runtime

Here's the concrete scenario:

1. User asks: "What's the status of Jane Smith's account and what's the weather in her city?"
2. LLM decides to call `customer_db_query` first.
   - **Pre-check:** No fingerprints in session. Cerbos allows it.
   - **Tool executes.** Returns customer data with PII.
   - **Post-execution:** Fingerprint registered: `{tags: ["pii"], data_class: "confidential"}`.
3. LLM decides to call `web_search` to look up weather.
   - **Pre-check:** Fingerprint cache has `pii` tag active. Cerbos evaluates `pii_blocks_external` rule. **Tool is denied.**
   - LLM receives: "Tool 'web_search' blocked by policy. Active sensitivity tags: {'pii'}. Try a different approach."
4. LLM calls `weather_api` instead (also external).
   - **Pre-check:** `pii` tag still active. `weather_api` is external. **Also denied.**
   - LLM adapts: responds with the customer info it has, tells the user it can't access external services while handling sensitive data.
5. After 20 minutes, the fingerprint expires. External tools become available again.

The LLM never knows about the fingerprint cache. It just receives tool-call errors with explanatory messages and adapts its behavior. The security layer is invisible to the model and transparent to the user.

### Lines of code

The entire implementation above is roughly:
- **FingerprintCache**: ~60 lines
- **Policy check function**: ~45 lines
- **Cerbos policy YAML**: ~30 lines
- **LangChain middleware**: ~45 lines

Under 200 lines total for the core mechanism. Everything else (Redis, Cerbos, LangChain) is off-the-shelf.

---

## Next steps

1. **Build a reference implementation.** A lightweight Python library that wraps any agentic orchestration loop with fingerprint tracking and policy evaluation. Redis-backed cache, YAML policy rules, hooks for plugging in existing scrubbers and classifiers. Small enough to be a single pip package.

2. **Validate against real attack scenarios.** The OWASP Top 10 for Agentic Applications (December 2025) identifies "Memory & Context Poisoning" (ASI06) and "Tool Misuse" (ASI02) as top risks. I want to build concrete demonstrations showing how fingerprinting prevents these: an agent that queries a customer database then tries to exfiltrate via web search, and the fingerprint layer blocks it.

3. **Write it up as a formal proposal.** NIST's AI Agent Standards Initiative has an open Request for Information on AI Agent Security (due March 2026) and an AI Agent Identity and Authorization Concept Paper (due April 2026). The fingerprinting concept addresses a gap that their call for input explicitly targets. CoSAI's Workstream 4 (Secure Design Patterns for Agentic Systems) is another venue.

4. **Engage with the MCP community.** The MCP spec's tool annotations (`readOnlyHint`, `destructiveHint`) are a starting point, but they're explicitly untrusted and don't include sensitivity metadata. A `sensitivityHint` or `dataClassHint` annotation that feeds into a fingerprint-aware policy layer would be a natural extension.

If any of this resonates, or if you want to collaborate on the reference implementation, reach out.

---

## Background

This concept grew out of the [AI Action Framework](../README.md), a tool orchestration system I built in June 2024 that independently arrived at the same dynamic tool discovery and LLM-driven routing patterns that Anthropic later standardized in MCP (November 2024). After building the orchestration layer, the natural next question was: "what happens when you deploy this in an enterprise and the LLM has access to sensitive data?" Memory fingerprinting is my answer to that question.

---

## Related work

- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) (ASI06: Memory & Context Poisoning)
- [NIST AI Agent Standards Initiative](https://www.nist.gov/caisi/ai-agent-standards-initiative)
- [CoSAI WS4: Secure Design Patterns for Agentic Systems](https://github.com/cosai-oasis/ws4-secure-design-agentic-systems)
- [AARM: Autonomous Action Runtime Management](https://arxiv.org/abs/2602.09433)
- [Cerbos (open source authorization)](https://www.cerbos.dev/)
- [Lasso MCP Gateway](https://github.com/lasso-security/mcp-gateway)

---

Copyright 2026 [Sean Hussey](https://www.linkedin.com/in/seanphussey/). Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
You are free to share and adapt this work for any purpose, including commercial, as long as you give appropriate credit.
