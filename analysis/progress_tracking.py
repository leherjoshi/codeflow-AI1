"""
Progress Tracking Module
Handles streak calculation, badge awarding, and progress updates
"""

from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from dataclasses import dataclass


@dataclass
class Badge:
    """Badge data model"""
    badge_id: str
    name: str
    earned_at: datetime
    milestone: int


@dataclass
class Progress:
    """Progress data model"""
    progress_id: str  # user_id#date
    user_id: str
    date: str  # ISO date
    problems_solved: int
    topics_practiced: List[str]
    streak_count: int
    badges: List[Badge]


# Milestone thresholds for badge awarding
MILESTONE_BADGES = {
    7: "7-day-streak",
    30: "30-day-streak",
    100: "100-day-streak"
}


def calculate_streak_increment(
    current_streak: int,
    last_solve_timestamp: Optional[datetime],
    new_solve_timestamp: datetime
) -> int:
    """
    Calculate the new streak count based on the last solve time and new solve time.
    
    Rules:
    - If last_solve_timestamp is None (first solve), streak starts at 1
    - If new solve is within 24 hours of last solve (same day or next day), increment streak
    - If new solve is more than 24 hours after last solve, reset streak to 1
    
    Args:
        current_streak: Current streak count
        last_solve_timestamp: Timestamp of last problem solve (None if first solve)
        new_solve_timestamp: Timestamp of new problem solve
    
    Returns:
        New streak count
    """
    # First solve ever
    if last_solve_timestamp is None:
        return 1
    
    # Calculate time difference
    time_diff = new_solve_timestamp - last_solve_timestamp
    
    # If more than 24 hours have passed, reset streak
    if time_diff > timedelta(hours=24):
        return 1
    
    # If within 24 hours, increment streak
    return current_streak + 1


def check_streak_reset(
    current_streak: int,
    last_solve_timestamp: datetime,
    check_timestamp: datetime
) -> int:
    """
    Check if streak should be reset based on time elapsed since last solve.
    
    Rules:
    - If more than 24 hours have passed since last solve, reset to 0
    - Otherwise, maintain current streak
    
    Args:
        current_streak: Current streak count
        last_solve_timestamp: Timestamp of last problem solve
        check_timestamp: Current timestamp to check against
    
    Returns:
        Streak count (0 if reset, current_streak if maintained)
    """
    time_diff = check_timestamp - last_solve_timestamp
    
    # If more than 24 hours have passed without solving, reset streak
    if time_diff > timedelta(hours=24):
        return 0
    
    return current_streak


def award_milestone_badges(
    current_streak: int,
    previous_streak: int,
    existing_badges: List[Badge],
    timestamp: datetime
) -> List[Badge]:
    """
    Award milestone badges when streak reaches 7, 30, or 100 days.
    
    Rules:
    - Award badge when streak reaches milestone for the first time
    - Don't award duplicate badges
    - Check all milestones between previous and current streak
    
    Args:
        current_streak: New streak count
        previous_streak: Previous streak count
        existing_badges: List of already earned badges
        timestamp: Timestamp when milestone was reached
    
    Returns:
        List of newly awarded badges
    """
    new_badges = []
    existing_badge_ids = {badge.badge_id for badge in existing_badges}
    
    # Check each milestone
    for milestone, badge_id in MILESTONE_BADGES.items():
        # Award badge if:
        # 1. Current streak reached or exceeded milestone
        # 2. Previous streak was below milestone (first time reaching it)
        # 3. Badge hasn't been awarded before
        if (current_streak >= milestone and 
            previous_streak < milestone and 
            badge_id not in existing_badge_ids):
            
            new_badges.append(Badge(
                badge_id=badge_id,
                name=f"{milestone} Day Streak",
                earned_at=timestamp,
                milestone=milestone
            ))
    
    return new_badges


def update_progress(
    user_id: str,
    solve_timestamp: datetime,
    current_progress: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Update user progress when they solve a problem.
    
    This is the main function that orchestrates streak calculation and badge awarding.
    
    Args:
        user_id: User ID
        solve_timestamp: Timestamp when problem was solved
        current_progress: Current progress data (None if first solve)
    
    Returns:
        Updated progress data
    """
    # Initialize progress if first solve
    if current_progress is None:
        return {
            'user_id': user_id,
            'streak_count': 1,
            'badges': [],
            'last_solve_timestamp': solve_timestamp,
            'problems_solved_today': 1
        }
    
    # Get current values
    current_streak = current_progress.get('streak_count', 0)
    last_solve_timestamp = current_progress.get('last_solve_timestamp')
    existing_badges = current_progress.get('badges', [])
    
    # Calculate new streak
    new_streak = calculate_streak_increment(
        current_streak,
        last_solve_timestamp,
        solve_timestamp
    )
    
    # Award badges if milestones reached
    new_badges = award_milestone_badges(
        new_streak,
        current_streak,
        existing_badges,
        solve_timestamp
    )
    
    # Update progress
    return {
        'user_id': user_id,
        'streak_count': new_streak,
        'badges': existing_badges + new_badges,
        'last_solve_timestamp': solve_timestamp,
        'problems_solved_today': current_progress.get('problems_solved_today', 0) + 1
    }
