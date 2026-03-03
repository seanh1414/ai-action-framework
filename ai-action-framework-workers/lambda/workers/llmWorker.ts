import axios from 'axios';
import Worker from '../worker';

const GPT4_API_KEY = process.env.OPENAI_API_KEY!;
const GPT4_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
// Placeholder URLs for other LLM models
const CLAUDE3_5_ENDPOINT = 'https://api.anthropic.com/v1/claude3.5';
const RAG_MODEL_ENDPOINT = 'https://api.ragmodel.com/v1/query';

class LLMWorker extends Worker {
    constructor() {
        super(
          "Utilizes various LLM models for complex queries, natural language processing, data analysis, and decision support.",
          "LLM",
          {
            GPT4O: {
              description: "Leverages GPT-4o for advanced natural language understanding, real-time translation, multimodal capabilities, and complex problem-solving. Suitable for tasks that require deep language comprehension and contextual understanding. Please note that while GPT-4o provides powerful AI capabilities, it may sometimes produce inaccurate information, so responses should be confirmed.",
              input: { query: "text", reason: "text" },
              output: { response: "text" },
              path: "/llm/gpt4o"
            },
            // Future endpoints can be added here, such as CLAUDE and RAG models example endpoints are included in code below but are not functional
          }
        );
      }

    async execute(endpointKey: string, inputs: any) {
        if (!inputs || !inputs.query) {
            throw new Error("Invalid inputs: query is required");
        }

        const query = inputs.query;
        const context = inputs.context || '';

        switch (endpointKey) {
            case "GPT4":
                return await this.callGPT4(query, context);
            case "CLAUDE3_5":
                return await this.callClaude3_5(query, context);
            case "RAG":
                return await this.callRAGModel(query, context);
            default:
                throw new Error(`Unsupported endpoint: ${endpointKey}`);
        }
    }

    private async callGPT4(query: string, context: string) {
        console.log(`Calling GPT-4 for query: ${query}`);

        try {
            const response = await axios.post(
                GPT4_ENDPOINT,
                {
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: 'You are a versatile AI assistant.' },
                        { role: 'user', content: `${context}\n\n${query}` }
                    ],
                    max_tokens: 1500,
                    temperature: 0.7,
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${GPT4_API_KEY}`,
                    },
                }
            );

            const gptResponse = response.data.choices[0].message.content.trim();
            console.log(`GPT-4 Response: ${gptResponse}`);
            return gptResponse;
        } catch (error: any) {
            console.error(`Error calling GPT-4: ${error.message}`);
            throw error;
        }
    }

    private async callClaude3_5(query: string, context: string) {
        console.log(`Calling Claude 3.5 for query: ${query}`);

        // Placeholder for actual Claude 3.5 API call
        // Replace with actual API call logic
        try {
            const response = await axios.post(
                CLAUDE3_5_ENDPOINT,
                { query, context },
                {
                    headers: { 'Authorization': `Bearer YOUR_CLAUDE3_5_API_KEY` }
                }
            );

            const claudeResponse = response.data.response;
            console.log(`Claude 3.5 Response: ${claudeResponse}`);
            return claudeResponse;
        } catch (error: any) {
            console.error(`Error calling Claude 3.5: ${error.message}`);
            throw error;
        }
    }

    private async callRAGModel(query: string, context: string) {
        console.log(`Calling RAG model for query: ${query}`);

        // Placeholder for actual RAG model API call
        // Replace with actual API call logic
        try {
            const response = await axios.post(
                RAG_MODEL_ENDPOINT,
                { query, context },
                {
                    headers: { 'Authorization': `Bearer YOUR_RAG_MODEL_API_KEY` }
                }
            );

            const ragResponse = response.data.response;
            console.log(`RAG Model Response: ${ragResponse}`);
            return ragResponse;
        } catch (error: any) {
            console.error(`Error calling RAG model: ${error.message}`);
            throw error;
        }
    }
}

// Export the execute function
export const execute = async (event: any) => {
    const body = JSON.parse(event.body);
    const { endpointKey, inputs } = body;
    const llmWorker = new LLMWorker();

    console.log(`Received event: ${JSON.stringify(event)}`);

    try {
        const result = await llmWorker.execute(endpointKey, inputs);
        console.log(`LLM worker result: ${result}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: result }),
        };
    } catch (error: any) {
        console.error(`Error while executing LLM worker: ${error.message}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Internal server error" }),
        };
    }
};

export default LLMWorker;
