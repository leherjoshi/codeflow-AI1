# ECS Fargate Workers

This directory contains Docker images for ECS Fargate workers that handle heavy AI workloads.

## Overview

ECS Fargate workers are used for processing tasks that exceed Lambda's timeout limits (15 minutes). These workers are triggered by EventBridge events and process messages from SQS queues.

## Workers

### 1. Weakness Analysis Worker

**Purpose**: Deep profile analysis using Amazon Bedrock Claude 3 Sonnet

**Resources**:
- CPU: 2 vCPU
- Memory: 4GB RAM
- Timeout: 15 minutes

**Triggers**:
- EventBridge event: `ProfileAnalysisComplete`
- SQS queue: `codeflow-background-jobs`

**Functionality**:
- Analyzes 100+ submissions for pattern recognition
- Identifies learning gaps and weaknesses
- Generates personalized learning paths
- Multi-step Bedrock reasoning

**Environment Variables**:
- `ENVIRONMENT`: Deployment environment (dev/staging/prod)
- `USERS_TABLE`: DynamoDB Users table name
- `LEARNING_PATHS_TABLE`: DynamoDB Learning Paths table name
- `PROGRESS_TABLE`: DynamoDB Progress table name
- `LLM_CACHE_TABLE`: DynamoDB LLM Cache table name
- `BACKGROUND_JOBS_QUEUE_URL`: SQS queue URL
- `AWS_REGION`: AWS region
- `WORKER_TYPE`: Worker type identifier
- `EVENT_TYPE`: EventBridge event type

## Building and Deploying

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Docker installed
3. ECR repository created (done by CDK)

### Build Docker Image

```bash
cd ecs-workers/weakness-analysis

# Build image
docker build -t codeflow-workers:latest .

# Test locally (optional)
docker run --rm \
  -e ENVIRONMENT=dev \
  -e AWS_REGION=us-east-1 \
  -e USERS_TABLE=codeflow-users-dev \
  -e LEARNING_PATHS_TABLE=codeflow-learning-paths-dev \
  -e PROGRESS_TABLE=codeflow-progress-dev \
  -e LLM_CACHE_TABLE=codeflow-llm-cache-dev \
  -e BACKGROUND_JOBS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/ACCOUNT/codeflow-background-jobs-dev \
  codeflow-workers:latest
```

### Push to ECR

```bash
# Get ECR repository URI from CDK outputs
ECR_REPO_URI=$(aws cloudformation describe-stacks \
  --stack-name CodeFlowInfrastructureStack-dev \
  --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryUri'].OutputValue" \
  --output text)

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $ECR_REPO_URI

# Tag image
docker tag codeflow-workers:latest $ECR_REPO_URI:latest
docker tag codeflow-workers:latest $ECR_REPO_URI:$(git rev-parse --short HEAD)

# Push image
docker push $ECR_REPO_URI:latest
docker push $ECR_REPO_URI:$(git rev-parse --short HEAD)
```

### Deploy Script

A deployment script is provided for convenience:

```bash
# From project root
./ecs-workers/deploy.sh dev
```

## Auto-Scaling

The ECS Fargate cluster is configured to auto-scale based on workload:

- **Minimum tasks**: 0 (cost optimization)
- **Maximum tasks**: 10
- **Scaling trigger**: SQS queue depth (ApproximateNumberOfMessagesVisible)
- **Scale-up threshold**: > 5 messages in queue
- **Scale-down threshold**: < 2 messages in queue

## Monitoring

### CloudWatch Logs

Logs are sent to CloudWatch Logs:
- Log Group: `/ecs/codeflow-workers-{environment}`
- Log Stream Prefix: `weakness-analysis`
- Retention: 14 days

### CloudWatch Metrics

Key metrics to monitor:
- `CPUUtilization`: CPU usage percentage
- `MemoryUtilization`: Memory usage percentage
- `TaskCount`: Number of running tasks
- `Bedrock Invocations`: Number of Bedrock API calls

### X-Ray Tracing

All workers are instrumented with AWS X-Ray for distributed tracing:
- Trace Bedrock invocations
- Trace DynamoDB operations
- Trace SQS message processing

## Troubleshooting

### Worker Not Starting

1. Check CloudWatch Logs for errors
2. Verify IAM role permissions
3. Ensure ECR image is available
4. Check VPC and security group configuration

### High Memory Usage

1. Review submission batch size
2. Optimize Bedrock prompt size
3. Implement pagination for large datasets

### Bedrock Throttling

1. Implement exponential backoff
2. Use LLM cache to reduce duplicate calls
3. Request quota increase from AWS

## Development

### Local Testing

To test the worker locally:

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export ENVIRONMENT=dev
export AWS_REGION=us-east-1
# ... (set other required env vars)

# Run worker
python worker.py
```

### Adding New Workers

1. Create new directory under `ecs-workers/`
2. Add Dockerfile, requirements.txt, and worker code
3. Update CDK stack to add new task definition
4. Update EventBridge rules to trigger new worker

## Cost Optimization

- Workers scale to 0 when idle (no charges)
- Use Fargate Spot for non-critical workloads (70% cost savings)
- Implement efficient Bedrock prompts to reduce token usage
- Use LLM cache to avoid duplicate Bedrock calls

## Security

- Workers run in private subnets (no public IP)
- IAM roles follow least privilege principle
- Secrets stored in AWS Secrets Manager (not environment variables)
- Container images scanned for vulnerabilities (ECR scan on push)
