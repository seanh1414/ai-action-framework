import * as AWS from 'aws-sdk';
import axios from 'axios';
import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_ORGANIZATION = process.env.OPENAI_ORGANIZATION!;
const OPENAI_PROJECT = process.env.OPENAI_PROJECT!;
const GPT_ENDPOINT = process.env.GPT_ENDPOINT || 'https://api.openai.com/v1/chat/completions';

const conversations: { [key: string]: any[] } = {};

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    console.log('Parsing event body...');
    const body = JSON.parse(event.body!);
    const userPrompt = body.prompt;
    const sessionId = body.sessionId || 'default';

    if (!conversations[sessionId]) {
      conversations[sessionId] = [];
    }

    conversations[sessionId].push({ role: 'user', content: userPrompt });

    console.log('Fetching registered workers from DynamoDB...');
    const workerData = await dynamoDB.scan({ TableName: 'Workers' }).promise();
    const workers = workerData.Items!.reduce((acc, worker) => {
      acc[worker.key] = worker;
      return acc;
    }, {} as { [key: string]: any });
    console.log('Registered workers:', workers);

    const initialPrompt = `
      You are a user assistant AI. Your job is to help the user by determining which APIs to call based on user inputs and return the result in JSON format.
      If you need more information from the user to proceed, ask for it using the format
      {
        "type": "user_input",
        "message": "<message>",
        "reason": "<reason>"
      }.
      Your response should be in the format {"type": "api_call", "worker_key": "<worker_key>", "endpoint_key": "<endpoint_key>", "input": <input_json>, "reason": "<reason>"}.
      After gathering the necessary information from the workers or the user, return the final answer to the user. Then, ask the user if they have any other questions.
      Only respond with the JSON formatted action, nothing else.
      Here are the available workers and their endpoints:
      ${Object.values(workers).map(worker => `
        Worker: ${worker.description}
        Key: ${worker.key}
        Endpoints:
        ${Object.entries(worker.endpoints).map(([key, endpoint]) => `
          - Endpoint Key: ${key}
          - Description: ${(endpoint as any).description}
          - Input: ${JSON.stringify((endpoint as any).input)}
          - Output: ${JSON.stringify((endpoint as any).output)}
        `).join('')}
      `).join('')}
      The user said: "${userPrompt}"

      Your goal is to answer the user's question as a helpful assistant using the data from the workers.
    `;
    console.log('Initial GPT Prompt:', initialPrompt);

    const initialGptResponse = await axios.post(
      GPT_ENDPOINT,
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a user assistant AI. Your job is to determine which APIs to call based on user inputs.' },
          { role: 'user', content: initialPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    let initialAction = initialGptResponse.data.choices[0].message.content.trim();
    console.log('Initial GPT Action:', initialAction);

    let parsedAction;
    try {
      parsedAction = JSON.parse(initialAction);
    } catch (e) {
      console.error('Error parsing initial GPT action:', e);
      throw new Error('Invalid GPT response format');
    }

    let continueConversation = true;
    let finalResponse: APIGatewayProxyResult | undefined = undefined;
    let userPromptCopy = userPrompt;

    while (continueConversation) {
      if (parsedAction.type === "user_input") {
        console.log('Extracting question for user...');
        const question = parsedAction.message;
        conversations[sessionId].push({ role: 'assistant', content: question });
        finalResponse = {
          statusCode: 200,
          body: JSON.stringify({ message: question, sessionId }),
        };
        continueConversation = false;
      } else if (parsedAction.type === "api_call") {
        console.log('Extracting action details...');
        const { worker_key, endpoint_key, input } = parsedAction;

        console.log('Finding the worker and endpoint...');
        console.log('Worker key:', worker_key);
        const worker = workers[worker_key];
        console.log('Worker:', worker);
        if (!worker) {
          throw new Error(`Worker ${worker_key} not found`);
        }
        const endpoint = worker.endpoints[endpoint_key];
        console.log('Endpoint:', endpoint);

        if (!endpoint || !endpoint.path) {
          throw new Error(`Endpoint for worker ${worker_key} with key ${endpoint_key} not found`);
        }
        console.log('Endpoint path:', endpoint.path);

        console.log('Calling the worker endpoint...');
        const apiInput = { endpointKey: endpoint_key, inputs: input };
        const workerResponse = await axios.post(endpoint.path, apiInput);
        console.log('Worker response:', workerResponse.data);

        conversations[sessionId].push({ role: 'assistant', content: JSON.stringify(workerResponse.data) });

        if (workerResponse.data) {

          const nextPrompt = `
            The worker ${worker_key} responded with the following information for the ${endpoint_key} endpoint:
            ${JSON.stringify(workerResponse.data)}

            The user's original request was: "${userPromptCopy}"

            Do you have enough information to answer the user's original question? If not, please call another API or ask the user for more details using the format
            {
              "type": "user_input",
              "message": "<message>",
              "reason": "<reason>"
            }.
            If you need to call another API, use the format
            {
              "type": "api_call",
              "worker_key": "<worker_key>",
              "endpoint_key": "<endpoint_key>",
              "input": <input_json>,
              "reason": "<reason>"
            }.
            If you have the final answer, respond with a natural language message to the user, including the result and asking if they have any other questions in the following format:
            {
              "type": "final_response",
              "message": "<result with follow-up ask for anything else?>"
            }.
            If you expect a single item in a response but get multiple, ask the user which they meant by providing the details and asking which they mean.
            Here are the available workers and their endpoints again:
            ${Object.values(workers).map(worker => `
              Worker: ${worker.description}
              Key: ${worker.key}
              Endpoints:
              ${Object.entries(worker.endpoints).map(([key, endpoint]) => `
                - Endpoint Key: ${key}
                - Description: ${(endpoint as any).description}
                - Input: ${JSON.stringify((endpoint as any).input)}
                - Output: ${JSON.stringify((endpoint as any).output)}
              `).join('')}
            `).join('')}
          `;
          console.log('Next GPT Prompt:', nextPrompt);


          const nextGptResponse = await axios.post(
            GPT_ENDPOINT,
            {
              model: 'gpt-4',
              messages: [
                { role: 'system', content: 'You are a user assistant AI. Your job is to determine which APIs to call based on user inputs.' },
                ...conversations[sessionId].map((message) => ({ role: message.role, content: message.content })),
                { role: 'user', content: nextPrompt }
              ],
              max_tokens: 3000,
              temperature: 0.7,
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
              },
            }
          );

          const nextAction = nextGptResponse.data.choices[0].message.content.trim();
          console.log('Next GPT Action:', nextAction);

          try {
            parsedAction = JSON.parse(nextAction);
          } catch (e) {
            console.error('Error parsing next GPT action:', e);
            throw new Error('Invalid GPT response format');
          }
        }
      } else if (parsedAction.type === "final_response") {
        console.log('Final response received...');
        const finalMessage = parsedAction.message;
        finalResponse = {
          statusCode: 200,
          body: JSON.stringify({ message: finalMessage, sessionId }),
        };
        continueConversation = false;
      }
    }
    return finalResponse!;
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error', error: String(error) }),
      callbackWaitsForEmptyEventLoop: false,
    };
  }
};
