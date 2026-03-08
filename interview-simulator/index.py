"""
AI Interview Simulator Lambda Function

Main handler for interview simulator API endpoints
"""

import json
import os
from typing import Dict, Any
from datetime import datetime
from pydantic import ValidationError

# Import modules
from models import (
    InterviewSession, InterviewType, SessionState,
    StartInterviewRequest, StartInterviewResponse,
    SubmitCodeRequest, SubmitCodeResponse,
    BehavioralResponseRequest, BehavioralResponseResponse,
    FeedbackResponse, SessionStatusResponse
)
from auth import validate_jwt_token, verify_session_ownership, get_cors_headers
from session_manager import create_session, get_session, update_session, update_session_state
from ai_interviewer import AIInterviewer
from performance_scorer import PerformanceScorer
import boto3

# Environment variables
USERS_TABLE = os.environ.get('USERS_TABLE', 'codeflow-users-dev')

# Initialize DynamoDB
dynamodb = boto3.resource('dynamodb')
users_table = dynamodb.Table(USERS_TABLE)
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for AI Interview Simulator
    
    Routes requests to appropriate handlers based on HTTP method and path
    """
    try:
        # Parse request
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Route to appropriate handler
        if http_method == 'POST' and path.endswith('/interview/start'):
            return handle_start_interview(event)
        elif http_method == 'POST' and path.endswith('/interview/submit'):
            return handle_submit_code(event)
        elif http_method == 'POST' and path.endswith('/interview/behavioral'):
            return handle_behavioral_response(event)
        elif http_method == 'GET' and '/interview/' in path and path.endswith('/feedback'):
            return handle_get_feedback(event)
        elif http_method == 'GET' and '/interview/' in path and path.endswith('/status'):
            return handle_get_status(event)
        else:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Not found'})
            }
    
    except Exception as e:
        print(f"Error in handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Internal server error'})
        }
def handle_start_interview(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle POST /interview/start
    
    Creates a new interview session and returns the first challenge
    """
    try:
        # Validate JWT and extract user_id
        user_id, error_response = validate_jwt_token(event)
        if error_response:
            return error_response
        
        # Parse request body
        body_str = event.get('body', '{}')
        body = json.loads(body_str)
        
        # Validate request
        try:
            request = StartInterviewRequest(**body)
        except ValidationError as e:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Invalid request', 'details': e.errors()})
            }
        
        # Create interview session
        session = InterviewSession(
            user_id=user_id,
            interview_type=request.interview_type,
            session_state=SessionState.ACTIVE
        )
        
        # Initialize AI Interviewer
        interviewer = AIInterviewer(
            interview_type=session.interview_type,
            session_id=session.session_id
        )
        
        # Select challenges
        challenges = interviewer.select_challenge(count=2)
        session.challenges = challenges
        
        # Generate intro message
        intro_message = interviewer.generate_intro_message()
        
        # Store session in DynamoDB
        create_session(session)
        
        # Return response
        response = StartInterviewResponse(
            session_id=session.session_id,
            interview_type=session.interview_type.value,
            challenge=challenges[0],
            intro_message=intro_message
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(response.dict())
        }
    
    except Exception as e:
        print(f"Error in handle_start_interview: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Failed to start interview', 'details': str(e)})
        }
def handle_submit_code(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle POST /interview/submit
    
    Evaluates submitted code and returns feedback
    """
    try:
        # Validate JWT
        user_id, error_response = validate_jwt_token(event)
        if error_response:
            return error_response
        
        # Parse request
        body_str = event.get('body', '{}')
        body = json.loads(body_str)
        
        try:
            request = SubmitCodeRequest(**body)
        except ValidationError as e:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Invalid request', 'details': e.errors()})
            }
        
        # Get session
        session = get_session(request.session_id)
        if not session:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Session not found'})
            }
        
        # Verify ownership
        ownership_error = verify_session_ownership(
            user_id,
            session.user_id,
            event.get('requestContext', {}).get('requestId')
        )
        if ownership_error:
            return ownership_error
        
        # Sanitize code
        sanitized_code = sanitize_code(request.code)
        
        # Initialize AI Interviewer
        interviewer = AIInterviewer(
            interview_type=session.interview_type,
            session_id=session.session_id
        )
        
        # Find problem description
        problem_description = ""
        for challenge in session.challenges:
            if challenge.problem_id == request.problem_id:
                problem_description = challenge.description
                break
        
        # Evaluate code
        evaluation = interviewer.evaluate_code(
            code=sanitized_code,
            problem_id=request.problem_id,
            problem_description=problem_description,
            bedrock_call_count=session.bedrock_call_count
        )
        
        # Update session
        session.code_solutions.append({
            'problem_id': request.problem_id,
            'code': sanitized_code,
            'language': request.language,
            'submitted_at': int(datetime.utcnow().timestamp())
        })
        session.evaluations.append(evaluation)
        session.bedrock_call_count += 1
        
        # Determine next step
        if len(session.code_solutions) < len(session.challenges):
            next_step = "next_challenge"
        else:
            next_step = "behavioral"
        
        # Update session in DynamoDB
        update_session(session)
        
        # Return response
        response = SubmitCodeResponse(
            evaluation=evaluation,
            next_step=next_step,
            feedback=evaluation.get('feedback', 'Good work!')
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(response.dict())
        }
    
    except Exception as e:
        print(f"Error in handle_submit_code: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Failed to evaluate code', 'details': str(e)})
        }
def handle_behavioral_response(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle POST /interview/behavioral
    
    Assesses behavioral response using STAR method
    """
    try:
        # Validate JWT
        user_id, error_response = validate_jwt_token(event)
        if error_response:
            return error_response
        
        # Parse request
        body_str = event.get('body', '{}')
        body = json.loads(body_str)
        
        try:
            request = BehavioralResponseRequest(**body)
        except ValidationError as e:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Invalid request', 'details': e.errors()})
            }
        
        # Get session
        session = get_session(request.session_id)
        if not session:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Session not found'})
            }
        
        # Verify ownership
        ownership_error = verify_session_ownership(
            user_id,
            session.user_id,
            event.get('requestContext', {}).get('requestId')
        )
        if ownership_error:
            return ownership_error
        
        # Initialize AI Interviewer
        interviewer = AIInterviewer(
            interview_type=session.interview_type,
            session_id=session.session_id
        )
        
        # Find question
        question_text = ""
        for bq in session.behavioral_questions:
            if bq.question_id == request.question_id:
                question_text = bq.question
                break
        
        # If no question found, generate one
        if not question_text:
            question_text = interviewer.generate_behavioral_question()
        
        # Assess response
        assessment = interviewer.assess_behavioral_response(
            question=question_text,
            response=request.response,
            bedrock_call_count=session.bedrock_call_count
        )
        
        # Update session
        from models import BehavioralQA
        behavioral_qa = BehavioralQA(
            question_id=request.question_id,
            question=question_text,
            response=request.response,
            assessment=assessment,
            follow_up=assessment.get('follow_up_question')
        )
        session.behavioral_questions.append(behavioral_qa)
        session.bedrock_call_count += 1
        
        # Determine next step
        if len(session.behavioral_questions) < 3:
            next_step = "continue"
        else:
            next_step = "complete"
        
        # Update session
        update_session(session)
        
        # Return response
        response = BehavioralResponseResponse(
            assessment=assessment,
            follow_up=assessment.get('follow_up_question'),
            next_step=next_step
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(response.dict())
        }
    
    except Exception as e:
        print(f"Error in handle_behavioral_response: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Failed to assess response', 'details': str(e)})
        }
def handle_get_feedback(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle GET /interview/{session_id}/feedback
    
    Generates comprehensive feedback report
    """
    try:
        # Validate JWT
        user_id, error_response = validate_jwt_token(event)
        if error_response:
            return error_response
        
        # Extract session_id from path
        path = event.get('path', '')
        session_id = path.split('/')[-2]
        
        # Get session
        session = get_session(session_id)
        if not session:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Session not found'})
            }
        
        # Verify ownership
        ownership_error = verify_session_ownership(
            user_id,
            session.user_id,
            event.get('requestContext', {}).get('requestId')
        )
        if ownership_error:
            return ownership_error
        
        # Calculate performance score
        scorer = PerformanceScorer(interview_type=session.interview_type)
        
        # Extract assessments from behavioral questions
        behavioral_assessments = []
        for bq in session.behavioral_questions:
            if bq.assessment:
                behavioral_assessments.append(bq.assessment)
        
        performance_score = scorer.calculate_overall_score(
            evaluations=session.evaluations,
            behavioral_assessments=behavioral_assessments
        )
        
        # Initialize AI Interviewer
        interviewer = AIInterviewer(
            interview_type=session.interview_type,
            session_id=session.session_id
        )
        
        # Generate feedback report
        session_data = session.dict()
        feedback_report = interviewer.generate_feedback_report(
            session_data=session_data,
            performance_score=performance_score,
            bedrock_call_count=session.bedrock_call_count
        )
        
        # Update session
        session.performance_score = performance_score
        session.feedback_report = feedback_report
        session.session_state = SessionState.COMPLETED
        session.bedrock_call_count += 1
        update_session(session)
        
        # Update user profile
        update_user_profile(user_id, session, performance_score)
        
        # Return response
        response = FeedbackResponse(
            feedback_report=feedback_report,
            session_state=SessionState.COMPLETED.value
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(response.dict())
        }
    
    except Exception as e:
        print(f"Error in handle_get_feedback: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Failed to generate feedback', 'details': str(e)})
        }
def handle_get_status(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle GET /interview/{session_id}/status
    
    Returns current session status and progress
    """
    try:
        # Validate JWT
        user_id, error_response = validate_jwt_token(event)
        if error_response:
            return error_response
        
        # Extract session_id from path
        path = event.get('path', '')
        session_id = path.split('/')[-2]
        
        # Get session
        session = get_session(session_id)
        if not session:
            return {
                'statusCode': 404,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': 'Session not found'})
            }
        
        # Verify ownership
        ownership_error = verify_session_ownership(
            user_id,
            session.user_id,
            event.get('requestContext', {}).get('requestId')
        )
        if ownership_error:
            return ownership_error
        
        # Calculate progress
        progress = {
            'challenges_total': len(session.challenges),
            'challenges_completed': len(session.code_solutions),
            'behavioral_questions_answered': len(session.behavioral_questions),
            'bedrock_calls_used': session.bedrock_call_count,
            'bedrock_calls_remaining': max(0, 10 - session.bedrock_call_count)
        }
        
        # Calculate time remaining (120 minutes from last activity)
        current_time = int(datetime.utcnow().timestamp())
        time_elapsed = current_time - session.last_activity_at
        time_remaining = max(0, (120 * 60) - time_elapsed)
        
        # Return response
        response = SessionStatusResponse(
            session_id=session.session_id,
            session_state=session.session_state.value,
            progress=progress,
            time_remaining=time_remaining
        )
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
            'body': json.dumps(response.dict())
        }
    
    except Exception as e:
        print(f"Error in handle_get_status: {str(e)}")
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({'error': 'Failed to get status', 'details': str(e)})
        }


# Helper functions
def sanitize_code(code: str) -> str:
    """
    Sanitize code to remove malicious patterns
    
    Args:
        code: Raw code string
        
    Returns:
        Sanitized code
    """
    # Remove script tags
    sanitized = code.replace('<script>', '').replace('</script>', '')
    
    # Remove common SQL injection patterns
    dangerous_patterns = ['DROP TABLE', 'DELETE FROM', 'INSERT INTO', 'UPDATE SET']
    for pattern in dangerous_patterns:
        sanitized = sanitized.replace(pattern, '')
        sanitized = sanitized.replace(pattern.lower(), '')
    
    # HTML escape for safe storage
    sanitized = sanitized.replace('<', '&lt;').replace('>', '&gt;')
    
    return sanitized
def update_user_profile(user_id: str, session: InterviewSession, performance_score: Any) -> None:
    """
    Update user profile with interview results
    
    Args:
        user_id: User identifier
        session: Interview session
        performance_score: Performance score
    """
    try:
        # Prepare interview history entry
        interview_entry = {
            'session_id': session.session_id,
            'interview_type': session.interview_type.value,
            'score': performance_score.overall_score,
            'date': datetime.utcnow().isoformat(),
            'duration': int(datetime.utcnow().timestamp()) - session.timestamp
        }
        
        # Update user profile
        users_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET interview_history = list_append(if_not_exists(interview_history, :empty_list), :new_entry)',
            ExpressionAttributeValues={
                ':new_entry': [interview_entry],
                ':empty_list': []
            }
        )
        
        print(f"Updated user profile for {user_id} with interview results")
        
    except Exception as e:
        print(f"Error updating user profile: {str(e)}")
        # Don't fail the request if profile update fails
