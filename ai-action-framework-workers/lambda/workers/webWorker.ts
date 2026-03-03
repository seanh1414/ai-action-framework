import axios from 'axios';
import Worker from '../worker';

const BING_API_KEY = process.env.BING_API_KEY!;
const BING_SEARCH_URL = 'https://api.bing.microsoft.com/v7.0/search';
const GPT_ENDPOINT = process.env.GPT_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

class WebWorker extends Worker {
    constructor() {
        super(
            "Searches the internet using the Bing Search API and summarizes results with GPT-4o.",
            "WEB",
            {
                SEARCH: {
                    description: "Search the internet and summarize results",
                    input: { query: "text", reason: "text" },
                    output: { summary: "text" },
                    path: "/search"
                }
            }
        );
    }

    async execute(endpointKey: string, inputs: any) {
        if (!inputs || !inputs.query || !inputs.reason) {
            throw new Error("Invalid inputs: query and reason are required");
        }

        const query = inputs.query;
        const reason = inputs.reason;

        if (endpointKey === "SEARCH") {
            return await this.searchAndSummarize(query, reason);
        }

        // Ensure a value is always returned
        return {};
    }

    private async searchAndSummarize(query: string, reason: string) {
        try {
            // 1. Query Bing API
            const bingResponse = await axios.get(BING_SEARCH_URL, {
                headers: { 'Ocp-Apim-Subscription-Key': BING_API_KEY },
                params: { q: query }
            });

            // 2. Extract relevant information from Bing response
            const bingResults = bingResponse.data.webPages.value.map((result: any) => result.snippet);
            const bingSummary = bingResults.join('\n');

            // 3. Call GPT-4o for summarization
            const gptResponse = await axios.post(
                GPT_ENDPOINT,
                {
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: `You are a user web researcher AI. Your job is to summarize the search results given that this was the reason for the search: ${reason}. Please summarize to answer this search reason and condense it for an LLM to understand.` },
                        { role: 'user', content: bingSummary }
                    ],
                    max_tokens: 200, // Adjust as needed
                    temperature: 0.7
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    },
                }
            );

            // Log the GPT response, excluding circular references
            console.log('GPT Response:', JSON.stringify(gptResponse.data, null, 2));

            // Handle the GPT response
            const choices = gptResponse.data.choices;
            const gptSummary = choices && choices.length > 0 && choices[0].message && choices[0].message.content
                ? choices[0].message.content.trim()
                : 'No summary available';

            if (!choices || choices.length === 0 || !choices[0].message || !choices[0].message.content) {
                console.error('Invalid GPT response structure:', JSON.stringify(gptResponse.data, null, 2));
            }

            console.log(`GPT-4o Summary: ${gptSummary}`);
            return { summary: gptSummary };
        } catch (error) {
            console.error(`Error executing web worker: ${(error as any).message}` as any);
            throw error;
        }
    }
}

// Lambda handler to invoke the worker
export const execute = async (event: any) => {
    try {
        const body = JSON.parse(event.body);
        const { endpointKey, inputs } = body;

        const worker = new WebWorker();
        const result = await worker.execute(endpointKey, inputs);

        return {
            statusCode: 200,
            body: JSON.stringify(result),
        };
    } catch (error) {
        console.error(`Error executing lambda function: ${(error as any).message}`);
        return {
            statusCode: 500,
            body: JSON.stringify((error as any).message),
        };
    }
};

export default WebWorker;
