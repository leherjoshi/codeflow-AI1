#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodeFlowInfrastructureStack } from '../lib/codeflow-infrastructure-stack';

const app = new cdk.App();

// Get environment configuration from context or environment variables
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

// Get environment name (dev, staging, prod)
const environmentName = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';

new CodeFlowInfrastructureStack(app, `CodeFlowInfrastructure-${environmentName}`, {
  env,
  environmentName,
  description: 'CodeFlow AI Platform - AWS Infrastructure Stack',
  tags: {
    Project: 'CodeFlow-AI',
    Environment: environmentName,
    ManagedBy: 'AWS-CDK',
  },
});

app.synth();
