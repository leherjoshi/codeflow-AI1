"""
ECS Fargate Worker for Weakness Analysis

This worker processes heavy AI workloads that exceed Lambda timeout limits.
It performs deep profile analysis using Amazon Bedrock Claude 3 Sonnet.

Architecture:
- Triggered by EventBridge events (ProfileAnalysisComplete)
- Processes 100+ submissions for pattern recognition
- Multi-step Bedrock reasoning for learning gap identification
- Stores results in DynamoDB (LearningPaths table)

Resources: 2 vCPU, 4GB RAM
Timeout: 15 minutes
"""

import os
import json
import asyncio
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel, Field
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all

# Patch AWS SDK for X-Ray tracing
patch_all()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# AWS clients
dynamodb = boto3.resource('dynamodb')
bedrock_runtime = boto3.client('bedrock-runtime')
sqs = boto3.client('sqs')

# Environment variables
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')
USERS_TABLE = os.environ.get('USERS_TABLE')
LEARNING_PATHS_TABLE = os.environ.get('LEARNING_PATHS_TABLE')
PROGRESS_TABLE = os.environ.get('PROGRESS_TABLE')
LLM_CACHE_TABLE = os.environ.get('LLM_CACHE_TABLE')
BACKGROUND_JOBS_QUEUE_URL = os.environ.get('BACKGROUND_JOBS_QUEUE_URL')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')


class ProfileAnalysisEvent(BaseModel):
    """Event payload for profile analysis"""
    user_id: str
    leetcode_username: str
    submission_count: int
    timestamp: str


class WeaknessAnalysisResult(BaseModel):
    """Result of weakness analysis"""
    user_id: str
    weaknesses: List[Dict[str, Any]]
    strengths: List[Dict[str, Any]]
    recommended_topics: List[str]
    learning_path_id: str
    analysis_timestamp: str
    bedrock_invocations: int = 0


class WeaknessAnalysisWorker:
    """
    ECS Fargate worker for deep profile analysis
    
    Processes heavy AI workloads that exceed Lambda timeout limits
    """
    
    def __init__(self):
        self.users_table = dynamodb.Table(USERS_TABLE)
        self.learning_paths_table = dynamodb.Table(LEARNING_PATHS_TABLE)
        self.progress_table = dynamodb.Table(PROGRESS_TABLE)
        self.llm_cache_table = dynamodb.Table(LLM_CACHE_TABLE)
    
    @xray_recorder.capture('process_event')
    async def process_event(self, event: Dict[str, Any]) -> WeaknessAnalysisResult:
        """
        Process ProfileAnalysisComplete event
        
        Args:
            event: EventBridge event payload
            
        Returns:
            WeaknessAnalysisResult with analysis findings
        """
        logger.info(f"Processing event: {json.dumps(event)}")
        
        # Parse event
        try:
            profile_event = ProfileAnalysisEvent(**event)
        except Exception as e:
            logger.error(f"Failed to parse event: {e}")
            raise
        
        # Fetch user data
        user_data = await self._fetch_user_data(profile_event.user_id)
        
        # Fetch submission history
        submissions = await self._fetch_submissions(profile_event.user_id)
        
        # Perform weakness analysis using Bedrock
        analysis_result = await self._analyze_weaknesses(
            user_data=user_data,
            submissions=submissions
        )
        
        # Store results in DynamoDB
        await self._store_results(analysis_result)
        
        logger.info(f"Completed weakness analysis for user {profile_event.user_id}")
        return analysis_result
    
    @xray_recorder.capture('fetch_user_data')
    async def _fetch_user_data(self, user_id: str) -> Dict[str, Any]:
        """Fetch user data from DynamoDB"""
        try:
            response = self.users_table.get_item(Key={'user_id': user_id})
            return response.get('Item', {})
        except ClientError as e:
            logger.error(f"Failed to fetch user data: {e}")
            raise
    
    @xray_recorder.capture('fetch_submissions')
    async def _fetch_submissions(self, user_id: str) -> List[Dict[str, Any]]:
        """Fetch user submission history from DynamoDB"""
        try:
            response = self.progress_table.query(
                IndexName='user-id-index',
                KeyConditionExpression='user_id = :user_id',
                ExpressionAttributeValues={':user_id': user_id},
                Limit=100  # Fetch last 100 submissions
            )
            return response.get('Items', [])
        except ClientError as e:
            logger.error(f"Failed to fetch submissions: {e}")
            raise
    
    @xray_recorder.capture('analyze_weaknesses')
    async def _analyze_weaknesses(
        self,
        user_data: Dict[str, Any],
        submissions: List[Dict[str, Any]]
    ) -> WeaknessAnalysisResult:
        """
        Perform deep weakness analysis using Amazon Bedrock
        
        This is a multi-step reasoning process:
        1. Analyze submission patterns across topics
        2. Identify weak areas (low success rate, long solve times)
        3. Identify strong areas (high success rate, fast solve times)
        4. Generate recommended learning path
        """
        logger.info(f"Analyzing {len(submissions)} submissions")
        
        # Prepare prompt for Bedrock
        prompt = self._build_analysis_prompt(user_data, submissions)
        
        # Invoke Bedrock Claude 3 Sonnet
        try:
            response = bedrock_runtime.invoke_model(
                modelId='anthropic.claude-3-sonnet-20240229-v1:0',
                contentType='application/json',
                accept='application/json',
                body=json.dumps({
                    'anthropic_version': 'bedrock-2023-05-31',
                    'max_tokens': 4096,
                    'temperature': 0.3,  # Lower temperature for analytical tasks
                    'messages': [
                        {
                            'role': 'user',
                            'content': prompt
                        }
                    ]
                })
            )
            
            response_body = json.loads(response['body'].read())
            analysis_text = response_body['content'][0]['text']
            
            # Parse Bedrock response
            analysis_data = self._parse_bedrock_response(analysis_text)
            
            # Create result object
            result = WeaknessAnalysisResult(
                user_id=user_data['user_id'],
                weaknesses=analysis_data.get('weaknesses', []),
                strengths=analysis_data.get('strengths', []),
                recommended_topics=analysis_data.get('recommended_topics', []),
                learning_path_id=f"path-{user_data['user_id']}-{datetime.utcnow().isoformat()}",
                analysis_timestamp=datetime.utcnow().isoformat(),
                bedrock_invocations=1
            )
            
            return result
            
        except ClientError as e:
            logger.error(f"Bedrock invocation failed: {e}")
            raise
    
    def _build_analysis_prompt(
        self,
        user_data: Dict[str, Any],
        submissions: List[Dict[str, Any]]
    ) -> str:
        """Build prompt for Bedrock analysis"""
        return f"""You are an expert coding mentor analyzing a student's LeetCode performance.

User Profile:
- Username: {user_data.get('leetcode_username', 'Unknown')}
- Total Submissions: {len(submissions)}

Submission History:
{json.dumps(submissions[:20], indent=2)}  # Show first 20 for context

Task:
Analyze the submission patterns and identify:
1. Weaknesses: Topics with low success rate or long solve times
2. Strengths: Topics with high success rate or fast solve times
3. Recommended Topics: Next topics to focus on for improvement

Provide your analysis in the following JSON format:
{{
    "weaknesses": [
        {{"topic": "Dynamic Programming", "success_rate": 0.4, "avg_time_minutes": 45, "reason": "Struggles with memoization"}},
        ...
    ],
    "strengths": [
        {{"topic": "Arrays", "success_rate": 0.9, "avg_time_minutes": 15, "reason": "Strong understanding of two-pointer technique"}},
        ...
    ],
    "recommended_topics": ["Dynamic Programming", "Graphs", "Backtracking"]
}}

Respond ONLY with valid JSON, no additional text.
"""
    
    def _parse_bedrock_response(self, response_text: str) -> Dict[str, Any]:
        """Parse Bedrock response into structured data"""
        try:
            # Try to extract JSON from response
            # Bedrock might include additional text, so we need to find the JSON block
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1
            
            if start_idx == -1 or end_idx == 0:
                logger.warning("No JSON found in Bedrock response, using defaults")
                return {
                    'weaknesses': [],
                    'strengths': [],
                    'recommended_topics': []
                }
            
            json_str = response_text[start_idx:end_idx]
            return json.loads(json_str)
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Bedrock response: {e}")
            return {
                'weaknesses': [],
                'strengths': [],
                'recommended_topics': []
            }
    
    @xray_recorder.capture('store_results')
    async def _store_results(self, result: WeaknessAnalysisResult) -> None:
        """Store analysis results in DynamoDB"""
        try:
            self.learning_paths_table.put_item(
                Item={
                    'path_id': result.learning_path_id,
                    'user_id': result.user_id,
                    'weaknesses': result.weaknesses,
                    'strengths': result.strengths,
                    'recommended_topics': result.recommended_topics,
                    'analysis_timestamp': result.analysis_timestamp,
                    'bedrock_invocations': result.bedrock_invocations,
                    'created_at': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat(),
                }
            )
            logger.info(f"Stored learning path: {result.learning_path_id}")
        except ClientError as e:
            logger.error(f"Failed to store results: {e}")
            raise


async def process_sqs_messages():
    """
    Process messages from SQS queue
    
    This is an alternative entry point for SQS-based processing
    """
    worker = WeaknessAnalysisWorker()
    
    while True:
        try:
            # Receive messages from SQS
            response = sqs.receive_message(
                QueueUrl=BACKGROUND_JOBS_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,  # Long polling
                VisibilityTimeout=900  # 15 minutes
            )
            
            messages = response.get('Messages', [])
            
            if not messages:
                logger.info("No messages in queue, waiting...")
                await asyncio.sleep(5)
                continue
            
            for message in messages:
                try:
                    # Parse message body
                    body = json.loads(message['Body'])
                    
                    # Process event
                    result = await worker.process_event(body)
                    
                    # Delete message from queue
                    sqs.delete_message(
                        QueueUrl=BACKGROUND_JOBS_QUEUE_URL,
                        ReceiptHandle=message['ReceiptHandle']
                    )
                    
                    logger.info(f"Successfully processed message: {message['MessageId']}")
                    
                except Exception as e:
                    logger.error(f"Failed to process message: {e}")
                    # Message will become visible again after visibility timeout
                    
        except Exception as e:
            logger.error(f"Error in SQS polling loop: {e}")
            await asyncio.sleep(5)


async def process_eventbridge_event():
    """
    Process EventBridge event (direct invocation)
    
    This is the primary entry point for EventBridge-triggered tasks
    """
    # EventBridge passes event details via environment variable or stdin
    # For now, we'll implement SQS-based processing
    logger.info("Starting EventBridge event processing mode")
    await process_sqs_messages()


async def main():
    """Main entry point"""
    logger.info(f"Starting Weakness Analysis Worker (Environment: {ENVIRONMENT})")
    logger.info(f"Worker Type: {os.environ.get('WORKER_TYPE', 'unknown')}")
    
    # Determine processing mode
    event_type = os.environ.get('EVENT_TYPE')
    
    if event_type == 'ProfileAnalysisComplete':
        logger.info("Processing EventBridge event")
        await process_eventbridge_event()
    else:
        logger.info("Processing SQS messages")
        await process_sqs_messages()


if __name__ == '__main__':
    asyncio.run(main())
