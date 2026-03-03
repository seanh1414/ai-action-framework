import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class AiActionFrameworkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda Layer
    const lambdaLayer = new lambda.LayerVersion(this, 'LambdaLayer', {
      code: lambda.Code.fromAsset('lambda-layer'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'A layer for shared dependencies',
    });

    // DynamoDB Table for Worker Registry
    const table = new dynamodb.Table(this, 'Workers', {
      partitionKey: { name: 'key', type: dynamodb.AttributeType.STRING },
      tableName: 'Workers'
    });

    // Registry Handler Lambda
    const registryHandlerLambda = new lambda.Function(this, 'RegistryHandlerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('dist'),
      handler: 'lambda/index.registryHandler',
      layers: [lambdaLayer],
      environment: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
        OPENAI_ORG_ID: process.env.OPENAI_ORG_ID!,
        OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID!,
        WEATHER_API_KEY: process.env.WEATHER_API_KEY!,
        GPT_ENDPOINT: process.env.GPT_ENDPOINT!,
      },
      timeout: cdk.Duration.seconds(30),
    });

    // AI Action Handler Lambda
    const aiActionHandlerLambda = new lambda.Function(this, 'AIActionHandlerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('dist'),
      handler: 'lambda/index.aiActionHandler',
      environment: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
        OPENAI_ORG_ID: process.env.OPENAI_ORG_ID!,
        OPENAI_PROJECT_ID: process.env.OPENAI_PROJECT_ID!,
        WEATHER_API_KEY: process.env.WEATHER_API_KEY!,
        GPT_ENDPOINT: process.env.GPT_ENDPOINT!,
      },
      layers: [lambdaLayer],
      timeout: cdk.Duration.seconds(60),
    });

    // Grant DynamoDB read/write permissions to the registry and action handler Lambdas
    table.grantReadWriteData(registryHandlerLambda);
    table.grantReadWriteData(aiActionHandlerLambda);

    // API Gateway
    const api = new apigateway.RestApi(this, 'actionApi', {
      restApiName: 'AiActionFramework',
      description: 'This service serves the action handler and the registration service.',
    });

    // Registry integration
    const registerIntegration = new apigateway.LambdaIntegration(registryHandlerLambda);
    const register = api.root.addResource('register');
    register.addMethod('POST', registerIntegration);

    const getWorkersIntegration = new apigateway.LambdaIntegration(registryHandlerLambda);
    const workers = api.root.addResource('workers');
    workers.addMethod('GET', getWorkersIntegration);

    // Action handler integration
    const executeIntegration = new apigateway.LambdaIntegration(aiActionHandlerLambda);
    const execute = api.root.addResource('execute');
    execute.addMethod('POST', executeIntegration);

    // Outputs for the endpoints
    new cdk.CfnOutput(this, 'RegisterEndpoint', {
      value: api.urlForPath('/register'),
      description: 'The URL of the register endpoint',
    });

    new cdk.CfnOutput(this, 'GetWorkersEndpoint', {
      value: api.urlForPath('/workers'),
      description: 'The URL of the get workers endpoint',
    });

    new cdk.CfnOutput(this, 'ExecuteEndpoint', {
      value: api.urlForPath('/execute'),
      description: 'The URL of the execute endpoint',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.urlForPath('/'),
      description: 'The base URL of the API Gateway',
    });
  }
}
