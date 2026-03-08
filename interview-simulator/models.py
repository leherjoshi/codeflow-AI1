"""
Data models for AI Interview Simulator

Pydantic models for interview sessions, challenges, assessments, and feedback
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid


class SessionState(str, Enum):
    """Interview session states"""
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    EXPIRED = "expired"
    ERROR = "error"


class InterviewType(str, Enum):
    """Interview types"""
    FAANG = "faang"
    STARTUP = "startup"
    GENERAL = "general"


class CodingChallenge(BaseModel):
    """Coding challenge model"""
    problem_id: str = Field(..., description="Unique problem identifier")
    title: str = Field(..., description="Challenge title")
    description: str = Field(..., description="Problem description")
    difficulty: str = Field(..., description="Difficulty level")
    examples: List[Dict[str, Any]] = Field(default_factory=list, description="Example inputs/outputs")
    constraints: List[str] = Field(default_factory=list, description="Problem constraints")
    hints: List[str] = Field(default_factory=list, description="Hints for solving")
    test_cases: List[Dict[str, Any]] = Field(default_factory=list, description="Test cases")
    follow_up_questions: List[str] = Field(default_factory=list, description="Follow-up questions")
    
    class Config:
        use_enum_values = True


class BehavioralQA(BaseModel):
    """Behavioral question and answer model"""
    question_id: str = Field(..., description="Unique question identifier")
    question: str = Field(..., description="Behavioral question text")
    response: Optional[str] = Field(None, description="User's response")
    assessment: Optional[Dict[str, Any]] = Field(None, description="STAR method assessment")
    follow_up: Optional[str] = Field(None, description="Follow-up question")
    
    @validator('response')
    def validate_response_size(cls, v):
        if v and len(v) > 2000:
            raise ValueError("Behavioral response must be 2000 characters or less")
        return v
    
    class Config:
        use_enum_values = True


class PerformanceScore(BaseModel):
    """Performance scoring model"""
    overall_score: float = Field(..., ge=0, le=100, description="Overall score 0-100")
    coding_correctness: float = Field(..., ge=0, le=100, description="Code correctness score")
    code_quality: float = Field(..., ge=0, le=100, description="Code quality score")
    communication: float = Field(..., ge=0, le=100, description="Communication score")
    behavioral: float = Field(..., ge=0, le=100, description="Behavioral score")
    
    class Config:
        use_enum_values = True


class FeedbackReport(BaseModel):
    """Comprehensive feedback report model"""
    session_id: str = Field(..., description="Session identifier")
    overall_score: PerformanceScore = Field(..., description="Performance scores")
    technical_feedback: str = Field(..., description="Technical feedback with markdown")
    behavioral_feedback: str = Field(..., description="Behavioral feedback with markdown")
    communication_feedback: str = Field(..., description="Communication feedback")
    strengths: List[str] = Field(default_factory=list, description="Identified strengths")
    areas_for_improvement: List[str] = Field(default_factory=list, description="Areas to improve")
    recommendations: List[Dict[str, str]] = Field(default_factory=list, description="Prioritized recommendations")
    comparison_to_type: Optional[str] = Field(None, description="Comparison to typical performance")
    code_snippets: List[Dict[str, str]] = Field(default_factory=list, description="Code examples with syntax highlighting")
    
    class Config:
        use_enum_values = True


class InterviewSession(BaseModel):
    """Interview session model"""
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique session ID")
    user_id: str = Field(..., description="User identifier")
    interview_type: InterviewType = Field(default=InterviewType.GENERAL, description="Interview type")
    session_state: SessionState = Field(default=SessionState.ACTIVE, description="Current session state")
    timestamp: int = Field(default_factory=lambda: int(datetime.utcnow().timestamp()), description="Creation timestamp")
    last_activity_at: int = Field(default_factory=lambda: int(datetime.utcnow().timestamp()), description="Last activity timestamp")
    ttl: int = Field(default_factory=lambda: int((datetime.utcnow() + timedelta(days=30)).timestamp()), description="TTL for DynamoDB (30 days)")
    
    # Interview content
    challenges: List[CodingChallenge] = Field(default_factory=list, description="Coding challenges")
    behavioral_questions: List[BehavioralQA] = Field(default_factory=list, description="Behavioral Q&A")
    code_solutions: List[Dict[str, Any]] = Field(default_factory=list, description="Submitted code solutions")
    evaluations: List[Dict[str, Any]] = Field(default_factory=list, description="Code evaluations")
    
    # Session metadata
    bedrock_call_count: int = Field(default=0, description="Number of Bedrock calls made")
    conversation_history: List[Dict[str, str]] = Field(default_factory=list, description="Conversation context")
    s3_overflow_key: Optional[str] = Field(None, description="S3 key for overflow data")
    error_context: Optional[Dict[str, Any]] = Field(None, description="Error context for debugging")
    
    # Performance data
    performance_score: Optional[PerformanceScore] = Field(None, description="Final performance score")
    feedback_report: Optional[FeedbackReport] = Field(None, description="Final feedback report")
    
    @validator('code_solutions')
    def validate_code_size(cls, v):
        for solution in v:
            if 'code' in solution and len(solution['code']) > 10000:
                raise ValueError("Code solution must be 10,000 characters or less")
        return v
    
    class Config:
        use_enum_values = True


# API Request/Response Models

class StartInterviewRequest(BaseModel):
    """Request to start a new interview session"""
    interview_type: Optional[InterviewType] = Field(InterviewType.GENERAL, description="Interview type (defaults to general)")
    
    class Config:
        use_enum_values = True


class StartInterviewResponse(BaseModel):
    """Response for starting a new interview session"""
    session_id: str = Field(..., description="Session identifier")
    interview_type: str = Field(..., description="Interview type")
    challenge: CodingChallenge = Field(..., description="First coding challenge")
    intro_message: str = Field(..., description="Interviewer introduction")
    
    class Config:
        use_enum_values = True


class SubmitCodeRequest(BaseModel):
    """Request to submit code solution"""
    session_id: str = Field(..., description="Session identifier")
    problem_id: str = Field(..., description="Problem identifier")
    code: str = Field(..., description="Code solution")
    language: str = Field(default="python", description="Programming language")
    
    @validator('code')
    def validate_code_size(cls, v):
        if len(v) > 10000:
            raise ValueError("Code must be 10,000 characters or less")
        return v
    
    class Config:
        use_enum_values = True


class SubmitCodeResponse(BaseModel):
    """Response for code submission"""
    evaluation: Dict[str, Any] = Field(..., description="Code evaluation results")
    next_step: str = Field(..., description="Next step (continue, next_challenge, behavioral)")
    feedback: str = Field(..., description="Immediate feedback")
    
    class Config:
        use_enum_values = True


class BehavioralResponseRequest(BaseModel):
    """Request to submit behavioral response"""
    session_id: str = Field(..., description="Session identifier")
    question_id: str = Field(..., description="Question identifier")
    response: str = Field(..., description="User's response")
    
    @validator('response')
    def validate_response_size(cls, v):
        if len(v) > 2000:
            raise ValueError("Response must be 2000 characters or less")
        return v
    
    class Config:
        use_enum_values = True


class BehavioralResponseResponse(BaseModel):
    """Response for behavioral submission"""
    assessment: Dict[str, Any] = Field(..., description="STAR method assessment")
    follow_up: Optional[str] = Field(None, description="Follow-up question if needed")
    next_step: str = Field(..., description="Next step (continue, complete)")
    
    class Config:
        use_enum_values = True


class FeedbackResponse(BaseModel):
    """Response for feedback request"""
    feedback_report: FeedbackReport = Field(..., description="Comprehensive feedback report")
    session_state: str = Field(..., description="Final session state")
    
    class Config:
        use_enum_values = True


class SessionStatusResponse(BaseModel):
    """Response for session status request"""
    session_id: str = Field(..., description="Session identifier")
    session_state: str = Field(..., description="Current session state")
    progress: Dict[str, Any] = Field(..., description="Progress information")
    time_remaining: Optional[int] = Field(None, description="Time remaining in seconds")
    
    class Config:
        use_enum_values = True
