import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class DeployWorkersStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda Layer
    const lambdaLayer = new lambda.LayerVersion(this, 'LambdaLayer', {
      code: lambda.Code.fromAsset('lambda-layer'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'A layer for shared dependencies',
    });

    // Create and deploy worker functions
    const weatherWorkerLambda = new lambda.Function(this, 'WeatherWorkerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('dist'),
      handler: 'lambda/workers/weatherWorker.execute',
      layers: [lambdaLayer],
      environment: {
        WEATHER_API_KEY: process.env.WEATHER_API_KEY!,
      },
      timeout: cdk.Duration.seconds(30),
    });

    const projectWorkerLambda = new lambda.Function(this, 'ProjectWorkerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('dist'),
      handler: 'lambda/workers/projectWorker.execute',
      layers: [lambdaLayer],
      timeout: cdk.Duration.seconds(30),
    });

    const webWorkerLambda = new lambda.Function(this, 'WebWorkerLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('dist'),
      handler: 'lambda/workers/webWorker.execute',
      layers: [lambdaLayer],
      timeout: cdk.Duration.seconds(30),
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'workerApi', {
      restApiName: 'Worker Service',
      description: 'This service serves worker actions.',
    });

    // Weather worker integration
    const weatherIntegration = new apigateway.LambdaIntegration(weatherWorkerLambda);
    const weather = api.root.addResource('weather');
    weather.addMethod('POST', weatherIntegration);

    // Project worker integration
    const projectIntegration = new apigateway.LambdaIntegration(projectWorkerLambda);
    const project = api.root.addResource('project');
    project.addMethod('POST', projectIntegration);

    // Web worker integration
    const webIntegration = new apigateway.LambdaIntegration(webWorkerLambda);
    const web = api.root.addResource('web');
    const search = web.addResource('search');
    search.addMethod('POST', webIntegration);

    // Output the API endpoints
    new cdk.CfnOutput(this, 'WeatherWorkerApiEndpoint', {
      value: api.urlForPath('/weather'),
      description: 'Weather Worker API Endpoint',
    });

    new cdk.CfnOutput(this, 'ProjectWorkerApiEndpoint', {
      value: api.urlForPath('/project'),
      description: 'Project Worker API Endpoint',
    });

    new cdk.CfnOutput(this, 'WebWorkerApiEndpoint', {
      value: api.urlForPath('/web/search'),
      description: 'Web Worker API Endpoint',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.urlForPath('/'),
      description: 'The base URL of the API Gateway',
    });
  }
}
