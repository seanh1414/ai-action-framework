#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DeployWorkersStack } from '../lib/deploy_workers-stack';

const app = new cdk.App();
new DeployWorkersStack(app, 'DeployWorkersStack');
