#!/bin/bash

# Script to verify and guide Bedrock model access enablement
# Note: Model access must be enabled through AWS Console or by submitting access requests

set -e

# Configuration
REGION="${AWS_REGION:-ap-south-1}"
REQUIRED_MODELS=(
  "anthropic.claude-3-sonnet-20240229-v1:0"
  "anthropic.claude-3-haiku-20240307-v1:0"
  "amazon.titan-embed-text-v1"
)

echo "=========================================="
echo "Bedrock Model Access Verification"
echo "=========================================="
echo ""
echo "Region: $REGION"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ ERROR: AWS CLI is not installed"
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

echo "✅ AWS CLI is installed"
echo ""

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ ERROR: AWS credentials are not configured"
    echo "Please configure AWS CLI: aws configure"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✅ AWS credentials configured"
echo "   Account ID: $ACCOUNT_ID"
echo ""

# Check if Bedrock service is available in the region
echo "Checking Bedrock service availability..."
if ! aws bedrock list-foundation-models --region $REGION &> /dev/null; then
    echo "❌ ERROR: Bedrock service is not available in region $REGION"
    echo "Please use a region where Bedrock is available (e.g., ap-south-1, us-east-1, us-west-2)"
    exit 1
fi

echo "✅ Bedrock service is available in $REGION"
echo ""

# List all available foundation models
echo "Fetching available foundation models..."
AVAILABLE_MODELS=$(aws bedrock list-foundation-models --region $REGION --output json)

echo ""
echo "=========================================="
echo "Checking Required Model Access"
echo "=========================================="
echo ""

ALL_ACCESSIBLE=true

for MODEL_ID in "${REQUIRED_MODELS[@]}"; do
    echo "Checking: $MODEL_ID"
    
    # Try to get model details
    if aws bedrock get-foundation-model \
        --model-identifier "$MODEL_ID" \
        --region $REGION &> /dev/null; then
        
        # Check if model is accessible (not just available)
        MODEL_STATUS=$(aws bedrock get-foundation-model \
            --model-identifier "$MODEL_ID" \
            --region $REGION \
            --query 'modelDetails.modelLifecycle.status' \
            --output text 2>/dev/null || echo "UNKNOWN")
        
        if [ "$MODEL_STATUS" = "ACTIVE" ]; then
            echo "  ✅ Model is ACTIVE and accessible"
        else
            echo "  ⚠️  Model status: $MODEL_STATUS"
            echo "     You may need to request access"
            ALL_ACCESSIBLE=false
        fi
    else
        echo "  ❌ Model is NOT accessible"
        echo "     Access needs to be enabled"
        ALL_ACCESSIBLE=false
    fi
    echo ""
done

echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""

if [ "$ALL_ACCESSIBLE" = true ]; then
    echo "✅ All required models are accessible!"
    echo ""
    echo "You can now deploy the CDK stack:"
    echo "  cd infrastructure"
    echo "  cdk deploy --all"
    echo ""
    exit 0
else
    echo "⚠️  Some models are not accessible"
    echo ""
    echo "=========================================="
    echo "How to Enable Model Access"
    echo "=========================================="
    echo ""
    echo "Option 1: AWS Console (Recommended)"
    echo "  1. Go to: https://console.aws.amazon.com/bedrock/"
    echo "  2. Select region: $REGION"
    echo "  3. Click 'Model access' in the left sidebar"
    echo "  4. Click 'Manage model access'"
    echo "  5. Enable the following models:"
    for MODEL_ID in "${REQUIRED_MODELS[@]}"; do
        echo "     - $MODEL_ID"
    done
    echo "  6. Click 'Save changes'"
    echo "  7. Wait for access to be granted (usually a few minutes)"
    echo ""
    echo "Option 2: AWS CLI"
    echo "  Note: Model access requests via CLI may require additional steps"
    echo "  It's recommended to use the AWS Console for initial setup"
    echo ""
    echo "After enabling model access, run this script again to verify:"
    echo "  ./infrastructure/scripts/enable-bedrock-models.sh"
    echo ""
    exit 1
fi
