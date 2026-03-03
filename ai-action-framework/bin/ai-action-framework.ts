#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AiActionFrameworkStack } from '../lib/ai-action-framework-stack';

const app = new cdk.App();
new AiActionFrameworkStack(app, 'AiActionFrameworkStack');
