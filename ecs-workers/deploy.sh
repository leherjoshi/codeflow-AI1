#!/bin/bash

# ECS Fargate Worker Deployment Script
# Usage: ./deploy.sh <environment>
# Example: ./deploy.sh dev

set -e

# Check arguments
if [ $# -eq 0 ]; then
    echo "Usage: ./deploy.sh <environment>"
    echo "Example: ./deploy.sh dev"
    exit 1
fi

ENVIRONMENT=$1
WORKER_DIR="weakness-analysis"
AWS_REGION=${AWS_REGION:-us-east-1}

echo "========================================="
echo "ECS Fargate Worker Deployment"
echo "========================================="
echo "Environment: $ENVIRONMENT"
echo "Worker: $WORKER_DIR"
echo "Region: $AWS_REGION"
echo "========================================="

# Get ECR repository URI from CloudFormation outputs
echo "Fetching ECR repository URI..."
ECR_REPO_URI=$(aws cloudformation describe-stacks \
    --stack-name CodeFlowInfrastructureStack-$ENVIRONMENT \
    --region $AWS_REGION \
    --query "Stacks[0].Outputs[?OutputKey=='ECRRepositoryUri'].OutputValue" \
    --output text)

if [ -z "$ECR_REPO_URI" ]; then
    echo "Error: Could not fetch ECR repository URI"
    echo "Make sure the CDK stack is deployed"
    exit 1
fi

echo "ECR Repository: $ECR_REPO_URI"

# Get current git commit hash for tagging
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "local")
echo "Git Commit: $GIT_COMMIT"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO_URI

# Build Docker image
echo "Building Docker image..."
cd $WORKER_DIR
docker build -t codeflow-workers:$GIT_COMMIT .
docker tag codeflow-workers:$GIT_COMMIT codeflow-workers:latest

# Tag for ECR
echo "Tagging image for ECR..."
docker tag codeflow-workers:$GIT_COMMIT $ECR_REPO_URI:$GIT_COMMIT
docker tag codeflow-workers:$GIT_COMMIT $ECR_REPO_URI:latest

# Push to ECR
echo "Pushing image to ECR..."
docker push $ECR_REPO_URI:$GIT_COMMIT
docker push $ECR_REPO_URI:latest

echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo "Image: $ECR_REPO_URI:$GIT_COMMIT"
echo "Latest: $ECR_REPO_URI:latest"
echo "========================================="

# Get ECS cluster name
ECS_CLUSTER=$(aws cloudformation describe-stacks \
    --stack-name CodeFlowInfrastructureStack-$ENVIRONMENT \
    --region $AWS_REGION \
    --query "Stacks[0].Outputs[?OutputKey=='ECSClusterName'].OutputValue" \
    --output text)

echo "ECS Cluster: $ECS_CLUSTER"

# Get task definition ARN
TASK_DEF_ARN=$(aws cloudformation describe-stacks \
    --stack-name CodeFlowInfrastructureStack-$ENVIRONMENT \
    --region $AWS_REGION \
    --query "Stacks[0].Outputs[?OutputKey=='ECSTaskDefinitionArn'].OutputValue" \
    --output text)

echo "Task Definition: $TASK_DEF_ARN"

echo ""
echo "To manually run a task:"
echo "aws ecs run-task \\"
echo "  --cluster $ECS_CLUSTER \\"
echo "  --task-definition $TASK_DEF_ARN \\"
echo "  --launch-type FARGATE \\"
echo "  --network-configuration 'awsvpcConfiguration={subnets=[SUBNET_ID],securityGroups=[SG_ID],assignPublicIp=DISABLED}'"
echo ""
echo "Tasks will be automatically triggered by EventBridge events."
