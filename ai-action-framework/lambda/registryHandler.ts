import * as AWS from 'aws-sdk';
import { APIGatewayProxyHandler } from 'aws-lambda';

const dynamoDB = new AWS.DynamoDB.DocumentClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    if (event.httpMethod === 'POST' && event.path === '/register') {
      const worker = body;
      console.log('Registering worker:', worker);
      await dynamoDB.put({
        TableName: 'Workers',
        Item: worker
      }).promise();
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Worker registered successfully!' }),
      };
    } else if (event.httpMethod === 'GET' && event.path === '/workers') {
      console.log('Fetching workers...');
      const result = await dynamoDB.scan({ TableName: 'Workers' }).promise();
      console.log('Workers fetched:', result.Items);
      return {
        statusCode: 200,
        body: JSON.stringify(result.Items),
      };
    } else {
      console.log('Path not found:', event.path);
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'Not Found' }),
      };
    }
  } catch (error) {
    console.error('Error occurred:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error', error: String(error) }),
    };
  }
};
