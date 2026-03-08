#!/bin/bash

# CodeFlow AI Platform - Demo Setup Script
# Prepares the demo environment for hackathon presentation
# Run this script before the demo to verify everything works

set -e  # Exit on error

echo "=========================================="
echo "CodeFlow AI Platform - Demo Setup"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================================================
# Step 1: Check Prerequisites
# ============================================================================

echo "Step 1: Checking prerequisites..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install: https://aws.amazon.com/cli/${NC}"
    exit 1
fi
echo -e "${GREEN}✅ AWS CLI installed${NC}"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${YELLOW}⚠️  jq not found. Installing...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install jq
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sudo apt-get install -y jq
    else
        echo -e "${RED}❌ Please install jq manually: https://stedolan.github.io/jq/${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✅ jq installed${NC}"

# Check if curl is installed
if ! command -v curl &> /dev/null; then
    echo -e "${RED}❌ curl not found. Please install curl${NC}"
    exit 1
fi
echo -e "${GREEN}✅ curl installed${NC}"

echo ""

# ============================================================================
# Step 2: Get API Gateway URL
# ============================================================================

echo "Step 2: Getting API Gateway URL..."

# Try to get API Gateway URL from CloudFormation stack
STACK_NAME="CodeFlowInfrastructure-production"
API_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' \
    --output text \
    --region ap-south-1 2>/dev/null || echo "")

if [ -z "$API_URL" ]; then
    echo -e "${YELLOW}⚠️  Could not auto-detect API Gateway URL${NC}"
    echo "Please enter your API Gateway URL manually:"
    read -p "API URL: " API_URL
fi

if [ -z "$API_URL" ]; then
    echo -e "${RED}❌ API URL is required${NC}"
    exit 1
fi

echo -e "${GREEN}✅ API URL: $API_URL${NC}"
export API_URL

echo ""

# ============================================================================
# Step 3: Test API Health
# ============================================================================

echo "Step 3: Testing API health..."

# Test if API is accessible
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" || echo "000")

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✅ API is healthy (HTTP 200)${NC}"
elif [ "$HTTP_CODE" == "404" ]; then
    echo -e "${YELLOW}⚠️  API is accessible but /health endpoint not found (HTTP 404)${NC}"
    echo "This is OK if you haven't implemented the health endpoint yet"
else
    echo -e "${RED}❌ API is not accessible (HTTP $HTTP_CODE)${NC}"
    echo "Please check:"
    echo "  1. API Gateway is deployed"
    echo "  2. Lambda functions are deployed"
    echo "  3. API URL is correct"
    exit 1
fi

echo ""

# ============================================================================
# Step 4: Create Demo User
# ============================================================================

echo "Step 4: Creating demo user..."

# Generate unique demo username
TIMESTAMP=$(date +%s)
DEMO_USERNAME="demo_student_$TIMESTAMP"
DEMO_EMAIL="demo_$TIMESTAMP@codeflow.ai"
DEMO_PASSWORD="SecureDemo123!"

echo "Demo credentials:"
echo "  Username: $DEMO_USERNAME"
echo "  Email: $DEMO_EMAIL"
echo "  Password: $DEMO_PASSWORD"

# Register demo user
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
    -H "Content-Type: application/json" \
    -d "{
        \"leetcode_username\": \"$DEMO_USERNAME\",
        \"email\": \"$DEMO_EMAIL\",
        \"password\": \"$DEMO_PASSWORD\",
        \"language_preference\": \"en\"
    }" || echo '{"error": "API call failed"}')

# Check if registration was successful
if echo "$REGISTER_RESPONSE" | jq -e '.access_token' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Demo user created successfully${NC}"
    
    # Extract tokens
    ACCESS_TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.access_token')
    USER_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.user_id')
    
    echo "  User ID: $USER_ID"
    echo "  Access Token: ${ACCESS_TOKEN:0:20}..."
    
    export TOKEN="$ACCESS_TOKEN"
    export USER_ID="$USER_ID"
else
    echo -e "${RED}❌ Failed to create demo user${NC}"
    echo "Response: $REGISTER_RESPONSE"
    echo ""
    echo "This might be OK if the user already exists. Trying to login..."
    
    # Try to login instead
    LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{
            \"leetcode_username\": \"demo_student\",
            \"password\": \"SecureDemo123!\"
        }" || echo '{"error": "API call failed"}')
    
    if echo "$LOGIN_RESPONSE" | jq -e '.access_token' > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Logged in with existing demo user${NC}"
        
        ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token')
        USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.user_id')
        
        export TOKEN="$ACCESS_TOKEN"
        export USER_ID="$USER_ID"
    else
        echo -e "${RED}❌ Failed to login${NC}"
        echo "Response: $LOGIN_RESPONSE"
        echo ""
        echo "Please check:"
        echo "  1. Auth Lambda function is deployed"
        echo "  2. DynamoDB Users table exists"
        echo "  3. API Gateway is configured correctly"
        exit 1
    fi
fi

echo ""

# ============================================================================
# Step 5: Test Core Endpoints
# ============================================================================

echo "Step 5: Testing core endpoints..."

# Test 1: Profile Analysis
echo "Testing profile analysis..."
ANALYSIS_RESPONSE=$(curl -s -X POST "$API_URL/analyze/profile" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"$USER_ID\",
        \"leetcode_username\": \"$DEMO_USERNAME\"
    }" || echo '{"error": "API call failed"}')

if echo "$ANALYSIS_RESPONSE" | jq -e '.message' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Profile analysis endpoint works${NC}"
else
    echo -e "${YELLOW}⚠️  Profile analysis endpoint failed (this is OK if not implemented yet)${NC}"
fi

# Test 2: Learning Path Generation
echo "Testing learning path generation..."
PATH_RESPONSE=$(curl -s -X POST "$API_URL/recommendations/generate-path" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"$USER_ID\",
        \"weak_topics\": [\"dynamic-programming\"],
        \"strong_topics\": [\"arrays\"],
        \"proficiency_level\": \"intermediate\"
    }" || echo '{"error": "API call failed"}')

if echo "$PATH_RESPONSE" | jq -e '.path_id' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Learning path generation endpoint works${NC}"
else
    echo -e "${YELLOW}⚠️  Learning path generation endpoint failed (this is OK if not implemented yet)${NC}"
fi

# Test 3: Chat Mentor
echo "Testing chat mentor..."
CHAT_RESPONSE=$(curl -s -X POST "$API_URL/chat-mentor" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"user_id\": \"$USER_ID\",
        \"message\": \"What is dynamic programming?\",
        \"problem_id\": null
    }" || echo '{"error": "API call failed"}')

if echo "$CHAT_RESPONSE" | jq -e '.response' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Chat mentor endpoint works${NC}"
else
    echo -e "${YELLOW}⚠️  Chat mentor endpoint failed (this is OK if not implemented yet)${NC}"
fi

# Test 4: Progress Tracking
echo "Testing progress tracking..."
PROGRESS_RESPONSE=$(curl -s -X GET "$API_URL/progress/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" || echo '{"error": "API call failed"}')

if echo "$PROGRESS_RESPONSE" | jq -e '.user_id' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Progress tracking endpoint works${NC}"
else
    echo -e "${YELLOW}⚠️  Progress tracking endpoint failed (this is OK if not implemented yet)${NC}"
fi

echo ""

# ============================================================================
# Step 6: Check Bedrock Access
# ============================================================================

echo "Step 6: Checking Bedrock access..."

# Check if Claude 3 Sonnet is accessible
BEDROCK_MODELS=$(aws bedrock list-foundation-models \
    --region us-east-1 \
    --query 'modelSummaries[?contains(modelId, `claude-3-sonnet`)].modelId' \
    --output text 2>/dev/null || echo "")

if [ -n "$BEDROCK_MODELS" ]; then
    echo -e "${GREEN}✅ Bedrock Claude 3 Sonnet is accessible${NC}"
else
    echo -e "${YELLOW}⚠️  Could not verify Bedrock access${NC}"
    echo "Please ensure Bedrock model access is enabled in AWS Console"
fi

echo ""

# ============================================================================
# Step 7: Check DynamoDB Tables
# ============================================================================

echo "Step 7: Checking DynamoDB tables..."

# List tables with codeflow prefix
TABLES=$(aws dynamodb list-tables \
    --region ap-south-1 \
    --query 'TableNames[?contains(@, `codeflow`)]' \
    --output text 2>/dev/null || echo "")

if [ -n "$TABLES" ]; then
    TABLE_COUNT=$(echo "$TABLES" | wc -w)
    echo -e "${GREEN}✅ Found $TABLE_COUNT DynamoDB tables${NC}"
    echo "$TABLES" | tr '\t' '\n' | sed 's/^/  - /'
else
    echo -e "${YELLOW}⚠️  No DynamoDB tables found${NC}"
    echo "Please deploy infrastructure with CDK"
fi

echo ""

# ============================================================================
# Step 8: Check CloudWatch Logs
# ============================================================================

echo "Step 8: Checking CloudWatch logs..."

# List log groups with codeflow prefix
LOG_GROUPS=$(aws logs describe-log-groups \
    --region ap-south-1 \
    --log-group-name-prefix "/aws/lambda/codeflow" \
    --query 'logGroups[].logGroupName' \
    --output text 2>/dev/null || echo "")

if [ -n "$LOG_GROUPS" ]; then
    LOG_COUNT=$(echo "$LOG_GROUPS" | wc -w)
    echo -e "${GREEN}✅ Found $LOG_COUNT CloudWatch log groups${NC}"
    echo "$LOG_GROUPS" | tr '\t' '\n' | sed 's/^/  - /'
else
    echo -e "${YELLOW}⚠️  No CloudWatch log groups found${NC}"
    echo "Logs will be created when Lambda functions are invoked"
fi

echo ""

# ============================================================================
# Step 9: Generate Demo Environment File
# ============================================================================

echo "Step 9: Generating demo environment file..."

# Create .env file for demo
cat > .demo.env << EOF
# CodeFlow AI Platform - Demo Environment Variables
# Generated: $(date)

# API Configuration
export API_URL="$API_URL"

# Demo User Credentials
export DEMO_USERNAME="$DEMO_USERNAME"
export DEMO_EMAIL="$DEMO_EMAIL"
export DEMO_PASSWORD="$DEMO_PASSWORD"

# Authentication Tokens
export TOKEN="$TOKEN"
export USER_ID="$USER_ID"

# AWS Configuration
export AWS_REGION="ap-south-1"
export STACK_NAME="$STACK_NAME"

# Usage:
# source .demo.env
# Then run demo commands from DEMO-COMMANDS.sh
EOF

echo -e "${GREEN}✅ Demo environment file created: .demo.env${NC}"
echo ""

# ============================================================================
# Step 10: Summary
# ============================================================================

echo "=========================================="
echo "Demo Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Load demo environment:"
echo "   source .demo.env"
echo ""
echo "2. Test demo commands:"
echo "   bash infrastructure/docs/DEMO-COMMANDS.sh"
echo ""
echo "3. Review demo script:"
echo "   cat infrastructure/docs/HACKATHON-DEMO-SCRIPT.md"
echo ""
echo "4. Practice demo presentation:"
echo "   - Time yourself (aim for 8-10 minutes)"
echo "   - Test all API endpoints"
echo "   - Prepare backup slides"
echo ""
echo "5. Record demo video (optional):"
echo "   - Follow infrastructure/docs/DEMO-VIDEO-GUIDE.md"
echo "   - Use OBS Studio or Zoom"
echo "   - Upload to YouTube/Vimeo"
echo ""
echo "Demo credentials:"
echo "  API URL: $API_URL"
echo "  User ID: $USER_ID"
echo "  Token: ${TOKEN:0:20}..."
echo ""
echo "Good luck with your presentation! 🚀"
echo ""
