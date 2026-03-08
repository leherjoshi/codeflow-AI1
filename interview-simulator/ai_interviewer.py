"""
AI Interviewer Module

Manages interview flow, code evaluation, and behavioral assessment
"""

from typing import Dict, Any, List, Optional
import json

from models import InterviewType, CodingChallenge, BehavioralQA, PerformanceScore, FeedbackReport
from bedrock_client import invoke_bedrock, BedrockCallLimiter
from challenge_selector import select_challenges
from cache_manager import (
    check_evaluation_cache, store_evaluation_cache,
    check_behavioral_cache, store_behavioral_cache,
    check_feedback_cache, store_feedback_cache
)

# Interviewer persona prompts
PERSONA_PROMPTS = {
    "faang": """You are a senior technical interviewer at a top-tier tech company (FAANG). 
Your focus is on:
- Algorithmic complexity and optimization (time/space complexity analysis)
- System design thinking and scalability
- Leadership principles and behavioral competencies
- Code quality, edge cases, and production readiness
Be thorough, ask probing follow-up questions, and maintain high standards.""",
    
    "startup": """You are a technical interviewer at a fast-growing startup.
Your focus is on:
- Practical problem-solving and getting things done
- Product thinking and user impact
- Adaptability and learning agility
- Code that works and can be iterated quickly
Be pragmatic, focus on real-world applicability, and value creativity.""",
    
    "general": """You are a friendly and supportive technical interviewer.
Your focus is on:
- Balanced assessment of technical and soft skills
- Clear communication and problem-solving approach
- Foundational computer science concepts
- Growth potential and learning mindset
Be encouraging, provide helpful hints when needed, and create a positive experience."""
}

# Behavioral question templates
BEHAVIORAL_QUESTIONS = {
    "faang": [
        "Tell me about a time when you had to make a difficult technical decision with incomplete information.",
        "Describe a situation where you had to optimize a system for scale. What was your approach?",
        "Give me an example of when you disagreed with a team member. How did you handle it?",
        "Tell me about a time when you failed. What did you learn?",
        "Describe a project where you had to balance technical debt with feature delivery."
    ],
    "startup": [
        "Tell me about a time when you had to quickly learn a new technology to solve a problem.",
        "Describe a situation where you had to pivot your approach based on user feedback.",
        "Give me an example of when you took initiative beyond your role.",
        "Tell me about a time when you had to work with limited resources.",
        "Describe how you've contributed to product decisions in your previous roles."
    ],
    "general": [
        "Tell me about a challenging project you worked on. What made it challenging?",
        "Describe your approach to debugging a complex issue.",
        "Give me an example of when you helped a teammate.",
        "Tell me about a time when you received constructive feedback. How did you respond?",
        "Describe a technical concept you recently learned and how you applied it."
    ]
}


class AIInterviewer:
    """AI Interviewer for conducting technical interviews"""
    
    def __init__(self, interview_type: InterviewType, session_id: str):
        """
        Initialize AI Interviewer
        
        Args:
            interview_type: Type of interview (FAANG, startup, general)
            session_id: Session identifier
        """
        self.interview_type = interview_type
        self.session_id = session_id
        self.persona_prompt = PERSONA_PROMPTS.get(interview_type.value, PERSONA_PROMPTS["general"])
        self.call_limiter = BedrockCallLimiter()
        self.conversation_history = []
    def select_challenge(self, count: int = 2) -> List[CodingChallenge]:
        """Select coding challenges based on interview type"""
        return select_challenges(self.interview_type, count)
    def generate_intro_message(self) -> str:
        """Generate interviewer introduction message"""
        intros = {
            "faang": f"Hello! I'm your interviewer today. We'll be conducting a technical interview focused on algorithms and system design. I'll present you with coding challenges and ask behavioral questions to assess your problem-solving skills and experience. Feel free to think out loud and ask clarifying questions. Let's begin!",
            "startup": f"Hi! I'm excited to interview you today. We'll work through some practical coding problems and discuss your experience. I'm interested in seeing how you approach real-world challenges and your ability to adapt. Don't hesitate to ask questions or discuss trade-offs. Ready to start?",
            "general": f"Welcome! I'm here to help you showcase your skills in a supportive environment. We'll go through coding challenges and have a conversation about your experience. Remember, I'm here to see how you think and communicate, not just to test your knowledge. Take your time and let me know if you need any hints. Let's get started!"
        }
        return intros.get(self.interview_type.value, intros["general"])
    def evaluate_code(
        self,
        code: str,
        problem_id: str,
        problem_description: str,
        bedrock_call_count: int
    ) -> Dict[str, Any]:
        """
        Evaluate code solution using Bedrock with caching
        
        Args:
            code: Code solution
            problem_id: Problem identifier
            problem_description: Problem description
            bedrock_call_count: Current Bedrock call count
            
        Returns:
            Evaluation results dictionary
        """
        # Check call limit
        self.call_limiter.check_limit(bedrock_call_count)
        
        # Check cache first
        cached_eval = check_evaluation_cache(code, problem_id)
        if cached_eval:
            print(f"Cache HIT for code evaluation: {problem_id}")
            return cached_eval
        
        # Build evaluation prompt
        eval_prompt = f"""Evaluate this code solution for the following problem:

Problem: {problem_description}

Code Solution:
```
{code}
```

Please provide a comprehensive evaluation with:
1. Correctness: Does the code solve the problem correctly?
2. Time Complexity: What is the time complexity? Can it be optimized?
3. Space Complexity: What is the space complexity?
4. Code Quality: Is the code readable, well-structured, and following best practices?
5. Edge Cases: Does it handle edge cases properly?
6. Feedback: Specific suggestions for improvement

Format your response as JSON with keys: correctness, time_complexity, space_complexity, code_quality, edge_cases, feedback, overall_score (0-100)."""
        
        try:
            # Invoke Bedrock
            response = invoke_bedrock(
                prompt=eval_prompt,
                system_prompt=self.persona_prompt,
                temperature=0.3,  # Lower temperature for more consistent evaluation
                max_tokens=1500
            )
            
            # Parse JSON response
            try:
                evaluation = json.loads(response)
            except json.JSONDecodeError:
                # Fallback if response is not valid JSON
                evaluation = {
                    "correctness": "Unable to parse",
                    "time_complexity": "N/A",
                    "space_complexity": "N/A",
                    "code_quality": "N/A",
                    "edge_cases": "N/A",
                    "feedback": response,
                    "overall_score": 50
                }
            
            # Store in cache
            store_evaluation_cache(code, problem_id, evaluation)
            
            return evaluation
            
        except Exception as e:
            print(f"Error evaluating code: {str(e)}")
            raise
    def generate_behavioral_question(self) -> str:
        """Generate behavioral question based on interview type"""
        import random
        questions = BEHAVIORAL_QUESTIONS.get(self.interview_type.value, BEHAVIORAL_QUESTIONS["general"])
        return random.choice(questions)
    def assess_behavioral_response(
        self,
        question: str,
        response: str,
        bedrock_call_count: int
    ) -> Dict[str, Any]:
        """
        Assess behavioral response using STAR method
        
        Args:
            question: Behavioral question
            response: User's response
            bedrock_call_count: Current Bedrock call count
            
        Returns:
            Assessment dictionary with STAR analysis and follow-up
        """
        # Check call limit
        self.call_limiter.check_limit(bedrock_call_count)
        
        # Check cache
        cached_assessment = check_behavioral_cache(question, response)
        if cached_assessment:
            print(f"Cache HIT for behavioral assessment")
            return cached_assessment
        
        # Build assessment prompt
        assessment_prompt = f"""Assess this behavioral interview response using the STAR method:

Question: {question}

Response: {response}

Evaluate the response for:
1. Situation: Did they clearly describe the context?
2. Task: Did they explain their responsibility?
3. Action: Did they detail the specific actions they took?
4. Result: Did they share the outcome and what they learned?
5. Clarity: Was the response clear and well-structured?
6. Completeness: Did they provide enough detail?

Also generate a relevant follow-up question to dig deeper.

Format as JSON with keys: situation_score (0-100), task_score, action_score, result_score, clarity_score, completeness_score, overall_score, feedback, follow_up_question."""
        
        try:
            response_text = invoke_bedrock(
                prompt=assessment_prompt,
                system_prompt=self.persona_prompt,
                temperature=0.5,
                max_tokens=1000
            )
            
            # Parse JSON
            try:
                assessment = json.loads(response_text)
            except json.JSONDecodeError:
                assessment = {
                    "situation_score": 50,
                    "task_score": 50,
                    "action_score": 50,
                    "result_score": 50,
                    "clarity_score": 50,
                    "completeness_score": 50,
                    "overall_score": 50,
                    "feedback": response_text,
                    "follow_up_question": "Can you tell me more about that?"
                }
            
            # Store in cache
            store_behavioral_cache(question, response, assessment)
            
            return assessment
            
        except Exception as e:
            print(f"Error assessing behavioral response: {str(e)}")
            raise
    def generate_feedback_report(
        self,
        session_data: Dict[str, Any],
        performance_score: PerformanceScore,
        bedrock_call_count: int
    ) -> FeedbackReport:
        """
        Generate comprehensive feedback report
        
        Args:
            session_data: Complete session data
            performance_score: Calculated performance scores
            bedrock_call_count: Current Bedrock call count
            
        Returns:
            FeedbackReport instance
        """
        # Check call limit
        self.call_limiter.check_limit(bedrock_call_count)
        
        # Create session summary for cache key
        session_summary = json.dumps({
            "interview_type": session_data.get("interview_type"),
            "challenges_count": len(session_data.get("challenges", [])),
            "behavioral_count": len(session_data.get("behavioral_questions", [])),
            "overall_score": performance_score.overall_score
        })
        
        # Check cache
        cached_feedback = check_feedback_cache(session_summary)
        if cached_feedback:
            print(f"Cache HIT for feedback report")
            return FeedbackReport(**cached_feedback)
        
        # Build feedback generation prompt
        feedback_prompt = f"""Generate a comprehensive interview feedback report based on this session:

Interview Type: {session_data.get('interview_type')}
Overall Score: {performance_score.overall_score}/100
Coding Score: {performance_score.coding_correctness}/100
Code Quality: {performance_score.code_quality}/100
Communication: {performance_score.communication}/100
Behavioral: {performance_score.behavioral}/100

Session Summary:
- Challenges completed: {len(session_data.get('challenges', []))}
- Code evaluations: {len(session_data.get('evaluations', []))}
- Behavioral responses: {len(session_data.get('behavioral_questions', []))}

Please provide:
1. Technical Feedback (markdown formatted, 200-300 words)
2. Behavioral Feedback (markdown formatted, 150-200 words)
3. Communication Feedback (100-150 words)
4. Top 3 Strengths (bullet points)
5. Top 3 Areas for Improvement (bullet points)
6. 3-5 Prioritized Recommendations with priority levels (high/medium/low)
7. Comparison to typical {session_data.get('interview_type')} interview performance

Format as JSON with keys: technical_feedback, behavioral_feedback, communication_feedback, strengths (array), areas_for_improvement (array), recommendations (array of objects with 'text' and 'priority'), comparison_to_type."""
        
        try:
            response = invoke_bedrock(
                prompt=feedback_prompt,
                system_prompt=self.persona_prompt,
                temperature=0.6,
                max_tokens=2000
            )
            
            # Parse JSON
            try:
                feedback_data = json.loads(response)
            except json.JSONDecodeError:
                feedback_data = {
                    "technical_feedback": response[:500],
                    "behavioral_feedback": "See technical feedback",
                    "communication_feedback": "Good communication overall",
                    "strengths": ["Problem-solving", "Code structure"],
                    "areas_for_improvement": ["Optimization", "Edge cases"],
                    "recommendations": [{"text": "Practice more algorithms", "priority": "high"}],
                    "comparison_to_type": "Average performance"
                }
            
            # Create FeedbackReport
            report = FeedbackReport(
                session_id=session_data.get('session_id'),
                overall_score=performance_score,
                technical_feedback=feedback_data.get('technical_feedback', ''),
                behavioral_feedback=feedback_data.get('behavioral_feedback', ''),
                communication_feedback=feedback_data.get('communication_feedback', ''),
                strengths=feedback_data.get('strengths', []),
                areas_for_improvement=feedback_data.get('areas_for_improvement', []),
                recommendations=feedback_data.get('recommendations', []),
                comparison_to_type=feedback_data.get('comparison_to_type'),
                code_snippets=[]
            )
            
            # Store in cache
            store_feedback_cache(session_summary, report.dict())
            
            return report
            
        except Exception as e:
            print(f"Error generating feedback: {str(e)}")
            raise
    def provide_hint(self, problem_description: str, current_approach: str) -> str:
        """Provide a hint for stuck candidates"""
        hint_prompt = f"""The candidate is stuck on this problem:

Problem: {problem_description}

Their current approach: {current_approach}

Provide a helpful hint that guides them without giving away the solution. Be encouraging."""
        
        try:
            return invoke_bedrock(
                prompt=hint_prompt,
                system_prompt=self.persona_prompt,
                temperature=0.7,
                max_tokens=300
            )
        except Exception as e:
            return "Try breaking the problem down into smaller steps. What's the first thing you need to accomplish?"
    def generate_transition_message(self, from_section: str, to_section: str) -> str:
        """Generate smooth transition between interview sections"""
        transitions = {
            "coding_to_behavioral": "Great work on the coding challenges! Now let's shift gears and talk about your experiences. I'll ask you some behavioral questions.",
            "behavioral_to_feedback": "Thank you for sharing those experiences. I have all the information I need. Let me prepare your feedback report.",
            "challenge_to_challenge": "Nice! Let's move on to the next challenge."
        }
        key = f"{from_section}_to_{to_section}"
        return transitions.get(key, f"Let's move on to {to_section}.")
    def generate_conclusion_message(self, overall_score: float) -> str:
        """Generate interview conclusion message"""
        if overall_score >= 80:
            return "Excellent work today! You demonstrated strong technical skills and clear communication. Your feedback report is ready."
        elif overall_score >= 60:
            return "Good job today! You showed solid understanding with room for growth. Check your feedback report for detailed insights."
        else:
            return "Thank you for your time today. Your feedback report includes specific areas to focus on for improvement. Keep practicing!"
