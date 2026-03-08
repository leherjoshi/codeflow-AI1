"""
Challenge selection module for AI Interview Simulator

Selects appropriate challenges based on interview type
"""

import random
from typing import List, Dict, Any

from challenges import ALL_CHALLENGES
from models import CodingChallenge, InterviewType
def select_challenges(interview_type: InterviewType, count: int = 2) -> List[CodingChallenge]:
    """
    Select appropriate challenges based on interview type
    
    Args:
        interview_type: Type of interview (FAANG, startup, general)
        count: Number of challenges to select (default 2)
        
    Returns:
        List of CodingChallenge instances
    """
    # Get challenges for the interview type
    type_key = interview_type.value.lower()
    available_challenges = ALL_CHALLENGES.get(type_key, ALL_CHALLENGES["general"])
    
    # Randomly select challenges
    selected = random.sample(available_challenges, min(count, len(available_challenges)))
    
    # Convert to CodingChallenge models
    challenges = []
    for challenge_data in selected:
        challenge = CodingChallenge(**challenge_data)
        challenges.append(challenge)
    
    return challenges
def get_challenge_by_id(problem_id: str) -> Dict[str, Any]:
    """
    Get a specific challenge by problem ID
    
    Args:
        problem_id: Problem identifier
        
    Returns:
        Challenge data dictionary or None if not found
    """
    for challenges in ALL_CHALLENGES.values():
        for challenge in challenges:
            if challenge["problem_id"] == problem_id:
                return challenge
    return None

