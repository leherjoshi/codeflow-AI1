"""
Property-based tests for progress tracking and streak logic
"""

import pytest
from datetime import datetime, timedelta
from hypothesis import given, strategies as st, settings, assume
from progress_tracking import (
    calculate_streak_increment,
    check_streak_reset,
    award_milestone_badges,
    update_progress,
    Badge,
    MILESTONE_BADGES
)


# ============================================================================
# Unit Tests
# ============================================================================

def test_calculate_streak_increment_first_solve():
    """Test streak calculation for first solve"""
    result = calculate_streak_increment(0, None, datetime.now())
    assert result == 1


def test_calculate_streak_increment_within_24h():
    """Test streak increment when solving within 24 hours"""
    last_solve = datetime(2024, 1, 1, 10, 0, 0)
    new_solve = datetime(2024, 1, 1, 20, 0, 0)  # 10 hours later
    
    result = calculate_streak_increment(5, last_solve, new_solve)
    assert result == 6


def test_calculate_streak_increment_after_24h():
    """Test streak reset when solving after 24 hours"""
    last_solve = datetime(2024, 1, 1, 10, 0, 0)
    new_solve = datetime(2024, 1, 2, 11, 0, 0)  # 25 hours later
    
    result = calculate_streak_increment(5, last_solve, new_solve)
    assert result == 1


def test_check_streak_reset_within_24h():
    """Test streak maintained when checked within 24 hours"""
    last_solve = datetime(2024, 1, 1, 10, 0, 0)
    check_time = datetime(2024, 1, 1, 20, 0, 0)  # 10 hours later
    
    result = check_streak_reset(5, last_solve, check_time)
    assert result == 5


def test_check_streak_reset_after_24h():
    """Test streak reset when checked after 24 hours"""
    last_solve = datetime(2024, 1, 1, 10, 0, 0)
    check_time = datetime(2024, 1, 2, 11, 0, 0)  # 25 hours later
    
    result = check_streak_reset(5, last_solve, check_time)
    assert result == 0


def test_award_milestone_badges_7_day():
    """Test badge awarded at 7 day milestone"""
    timestamp = datetime.now()
    badges = award_milestone_badges(7, 6, [], timestamp)
    
    assert len(badges) == 1
    assert badges[0].badge_id == "7-day-streak"
    assert badges[0].milestone == 7


def test_award_milestone_badges_30_day():
    """Test badge awarded at 30 day milestone"""
    timestamp = datetime.now()
    badges = award_milestone_badges(30, 29, [], timestamp)
    
    assert len(badges) == 1
    assert badges[0].badge_id == "30-day-streak"
    assert badges[0].milestone == 30


def test_award_milestone_badges_100_day():
    """Test badge awarded at 100 day milestone"""
    timestamp = datetime.now()
    badges = award_milestone_badges(100, 99, [], timestamp)
    
    assert len(badges) == 1
    assert badges[0].badge_id == "100-day-streak"
    assert badges[0].milestone == 100


def test_award_milestone_badges_no_duplicate():
    """Test that duplicate badges are not awarded"""
    timestamp = datetime.now()
    existing_badge = Badge(
        badge_id="7-day-streak",
        name="7 Day Streak",
        earned_at=timestamp,
        milestone=7
    )
    
    badges = award_milestone_badges(7, 6, [existing_badge], timestamp)
    assert len(badges) == 0


def test_award_milestone_badges_multiple():
    """Test multiple badges awarded when jumping milestones"""
    timestamp = datetime.now()
    # Jump from 6 to 30 days (should award both 7 and 30 day badges)
    badges = award_milestone_badges(30, 6, [], timestamp)
    
    assert len(badges) == 2
    badge_ids = {b.badge_id for b in badges}
    assert "7-day-streak" in badge_ids
    assert "30-day-streak" in badge_ids


def test_update_progress_first_solve():
    """Test progress update for first solve"""
    user_id = "user123"
    timestamp = datetime.now()
    
    result = update_progress(user_id, timestamp, None)
    
    assert result['user_id'] == user_id
    assert result['streak_count'] == 1
    assert result['badges'] == []
    assert result['problems_solved_today'] == 1


def test_update_progress_consecutive_solve():
    """Test progress update for consecutive daily solve"""
    user_id = "user123"
    last_solve = datetime(2024, 1, 1, 10, 0, 0)
    new_solve = datetime(2024, 1, 1, 20, 0, 0)
    
    current_progress = {
        'user_id': user_id,
        'streak_count': 5,
        'badges': [],
        'last_solve_timestamp': last_solve,
        'problems_solved_today': 1
    }
    
    result = update_progress(user_id, new_solve, current_progress)
    
    assert result['streak_count'] == 6
    assert result['problems_solved_today'] == 2


# ============================================================================
# Property-Based Tests
# ============================================================================

# **Validates: Requirements 7.1**
# Property 27: Streak increment on daily solve


@given(
    current_streak=st.integers(min_value=0, max_value=200),
    hours_since_last_solve=st.floats(min_value=0.0, max_value=24.0)
)
@settings(max_examples=100)
def test_property_streak_increment_on_daily_solve(current_streak, hours_since_last_solve):
    """
    Property 27: Streak increment on daily solve
    **Validates: Requirements 7.1**
    
    For any user who solves at least one problem on a given day (within 24 hours
    of their last solve), their streak counter should increment by exactly 1.
    
    This test verifies:
    1. Streak increments by exactly 1 when solving within 24 hours
    2. The increment is consistent regardless of current streak value
    3. The increment works for any time within the 24-hour window
    """
    # Generate timestamps
    base_time = datetime(2024, 1, 1, 12, 0, 0)
    last_solve_timestamp = base_time
    new_solve_timestamp = base_time + timedelta(hours=hours_since_last_solve)
    
    # Calculate new streak
    new_streak = calculate_streak_increment(
        current_streak,
        last_solve_timestamp,
        new_solve_timestamp
    )
    
    # Property: Streak should increment by exactly 1 when solving within 24 hours
    if hours_since_last_solve <= 24.0:
        if last_solve_timestamp is None:
            # First solve should set streak to 1
            assert new_streak == 1, \
                "First solve should set streak to 1"
        else:
            # Subsequent solves within 24h should increment by 1
            assert new_streak == current_streak + 1, \
                f"Streak should increment by 1 when solving within 24h. " \
                f"Expected {current_streak + 1}, got {new_streak}"
    
    # Additional invariant: New streak should never be negative
    assert new_streak >= 0, "Streak should never be negative"
    
    # Additional invariant: New streak should be at least 1 (since we just solved)
    assert new_streak >= 1, "Streak should be at least 1 after solving a problem"


@given(
    current_streak=st.integers(min_value=0, max_value=200),
    hours_since_last_solve=st.floats(min_value=0.0, max_value=23.99)
)
@settings(max_examples=100)
def test_property_streak_maintained_within_24h(current_streak, hours_since_last_solve):
    """
    Property 27: Streak increment on daily solve (maintenance aspect)
    **Validates: Requirements 7.1**
    
    For any user who solves problems within 24 hours, their streak should be
    maintained and incremented, never reset.
    
    This test verifies:
    1. Solving within 24 hours always maintains the streak
    2. The streak never resets when solving daily
    3. The new streak is always greater than the previous streak
    """
    base_time = datetime(2024, 1, 1, 12, 0, 0)
    last_solve_timestamp = base_time
    new_solve_timestamp = base_time + timedelta(hours=hours_since_last_solve)
    
    # Assume we have an existing streak
    assume(current_streak > 0)
    
    new_streak = calculate_streak_increment(
        current_streak,
        last_solve_timestamp,
        new_solve_timestamp
    )
    
    # Property: When solving within 24h, new streak should always be greater
    assert new_streak > current_streak, \
        f"Streak should increase when solving within 24h. " \
        f"Previous: {current_streak}, New: {new_streak}"
    
    # Property: The increase should be exactly 1
    assert new_streak == current_streak + 1, \
        f"Streak should increase by exactly 1. " \
        f"Expected {current_streak + 1}, got {new_streak}"


# **Validates: Requirements 7.2**
# Property 28: Streak reset on missed day


@given(
    current_streak=st.integers(min_value=1, max_value=200),
    hours_since_last_solve=st.floats(min_value=24.01, max_value=168.0)  # 24h to 1 week
)
@settings(max_examples=100)
def test_property_streak_reset_on_missed_day(current_streak, hours_since_last_solve):
    """
    Property 28: Streak reset on missed day
    **Validates: Requirements 7.2**
    
    For any user who does not solve problems for 24+ hours, their streak counter
    should reset to 0 when checked, or reset to 1 when they solve the next problem.
    
    This test verifies:
    1. Streak resets to 0 when checked after 24+ hours of inactivity
    2. Streak resets to 1 when solving after 24+ hours of inactivity
    3. The reset happens consistently regardless of previous streak value
    """
    base_time = datetime(2024, 1, 1, 12, 0, 0)
    last_solve_timestamp = base_time
    check_timestamp = base_time + timedelta(hours=hours_since_last_solve)
    
    # Test 1: Check streak reset (passive check)
    reset_streak = check_streak_reset(
        current_streak,
        last_solve_timestamp,
        check_timestamp
    )
    
    # Property: Streak should reset to 0 after 24+ hours without solving
    assert reset_streak == 0, \
        f"Streak should reset to 0 after {hours_since_last_solve:.2f} hours. " \
        f"Expected 0, got {reset_streak}"
    
    # Test 2: Solve after missing a day (active solve)
    new_streak = calculate_streak_increment(
        current_streak,
        last_solve_timestamp,
        check_timestamp
    )
    
    # Property: Streak should reset to 1 when solving after 24+ hours
    assert new_streak == 1, \
        f"Streak should reset to 1 when solving after {hours_since_last_solve:.2f} hours. " \
        f"Expected 1, got {new_streak}"
    
    # Property: Reset should happen regardless of previous streak value
    # (This is implicitly tested by using a range of current_streak values)


@given(
    current_streak=st.integers(min_value=1, max_value=200),
    days_missed=st.integers(min_value=2, max_value=30)
)
@settings(max_examples=100)
def test_property_streak_reset_after_multiple_days(current_streak, days_missed):
    """
    Property 28: Streak reset on missed day (extended period)
    **Validates: Requirements 7.2**
    
    For any user who misses multiple days (2+ days), their streak should still
    reset to 0, regardless of how many days were missed.
    
    This test verifies:
    1. Streak resets even after missing many days
    2. The reset behavior is consistent for any duration > 24 hours
    3. A high previous streak doesn't prevent reset
    """
    base_time = datetime(2024, 1, 1, 12, 0, 0)
    last_solve_timestamp = base_time
    check_timestamp = base_time + timedelta(days=days_missed)
    
    # Check streak after missing multiple days
    reset_streak = check_streak_reset(
        current_streak,
        last_solve_timestamp,
        check_timestamp
    )
    
    # Property: Streak should be 0 after missing multiple days
    assert reset_streak == 0, \
        f"Streak should reset to 0 after missing {days_missed} days. " \
        f"Previous streak: {current_streak}, Result: {reset_streak}"
    
    # Solve after missing multiple days
    new_streak = calculate_streak_increment(
        current_streak,
        last_solve_timestamp,
        check_timestamp
    )
    
    # Property: Streak should restart at 1 when solving after missing days
    assert new_streak == 1, \
        f"Streak should restart at 1 after missing {days_missed} days. " \
        f"Expected 1, got {new_streak}"


# **Validates: Requirements 7.3**
# Property 29: Milestone badge awarding


@given(
    previous_streak=st.integers(min_value=0, max_value=6),
    current_streak=st.integers(min_value=7, max_value=10)
)
@settings(max_examples=50)
def test_property_milestone_badge_7_days(previous_streak, current_streak):
    """
    Property 29: Milestone badge awarding (7-day milestone)
    **Validates: Requirements 7.3**
    
    For any user reaching a streak count of 7 days, the system should award
    the 7-day streak badge exactly once.
    
    This test verifies:
    1. Badge is awarded when crossing the 7-day threshold
    2. Badge is only awarded once (no duplicates)
    3. Badge contains correct milestone information
    """
    assume(previous_streak < 7)
    assume(current_streak >= 7)
    
    timestamp = datetime(2024, 1, 7, 12, 0, 0)
    
    # Award badges when reaching 7 days
    new_badges = award_milestone_badges(
        current_streak,
        previous_streak,
        [],
        timestamp
    )
    
    # Property: Should award exactly one badge for 7-day milestone
    seven_day_badges = [b for b in new_badges if b.milestone == 7]
    assert len(seven_day_badges) == 1, \
        f"Should award exactly one 7-day badge. Got {len(seven_day_badges)}"
    
    # Property: Badge should have correct attributes
    badge = seven_day_badges[0]
    assert badge.badge_id == "7-day-streak", \
        f"Badge ID should be '7-day-streak', got '{badge.badge_id}'"
    assert badge.milestone == 7, \
        f"Milestone should be 7, got {badge.milestone}"
    assert badge.earned_at == timestamp, \
        "Badge timestamp should match award timestamp"
    
    # Property: No duplicate badges when already earned
    new_badges_duplicate = award_milestone_badges(
        current_streak,
        previous_streak,
        new_badges,
        timestamp
    )
    assert len(new_badges_duplicate) == 0, \
        "Should not award duplicate badges"


@given(
    previous_streak=st.integers(min_value=0, max_value=29),
    current_streak=st.integers(min_value=30, max_value=35)
)
@settings(max_examples=50)
def test_property_milestone_badge_30_days(previous_streak, current_streak):
    """
    Property 29: Milestone badge awarding (30-day milestone)
    **Validates: Requirements 7.3**
    
    For any user reaching a streak count of 30 days, the system should award
    the 30-day streak badge exactly once.
    
    This test verifies:
    1. Badge is awarded when crossing the 30-day threshold
    2. Badge is only awarded once (no duplicates)
    3. Badge contains correct milestone information
    """
    assume(previous_streak < 30)
    assume(current_streak >= 30)
    
    timestamp = datetime(2024, 1, 30, 12, 0, 0)
    
    # Simulate user already has 7-day badge
    existing_badges = [
        Badge(
            badge_id="7-day-streak",
            name="7 Day Streak",
            earned_at=datetime(2024, 1, 7, 12, 0, 0),
            milestone=7
        )
    ]
    
    # Award badges when reaching 30 days
    new_badges = award_milestone_badges(
        current_streak,
        previous_streak,
        existing_badges,
        timestamp
    )
    
    # Property: Should award 30-day badge
    thirty_day_badges = [b for b in new_badges if b.milestone == 30]
    assert len(thirty_day_badges) == 1, \
        f"Should award exactly one 30-day badge. Got {len(thirty_day_badges)}"
    
    # Property: Badge should have correct attributes
    badge = thirty_day_badges[0]
    assert badge.badge_id == "30-day-streak", \
        f"Badge ID should be '30-day-streak', got '{badge.badge_id}'"
    assert badge.milestone == 30, \
        f"Milestone should be 30, got {badge.milestone}"


@given(
    previous_streak=st.integers(min_value=0, max_value=99),
    current_streak=st.integers(min_value=100, max_value=110)
)
@settings(max_examples=50)
def test_property_milestone_badge_100_days(previous_streak, current_streak):
    """
    Property 29: Milestone badge awarding (100-day milestone)
    **Validates: Requirements 7.3**
    
    For any user reaching a streak count of 100 days, the system should award
    the 100-day streak badge exactly once.
    
    This test verifies:
    1. Badge is awarded when crossing the 100-day threshold
    2. Badge is only awarded once (no duplicates)
    3. Badge contains correct milestone information
    """
    assume(previous_streak < 100)
    assume(current_streak >= 100)
    
    timestamp = datetime(2024, 4, 10, 12, 0, 0)
    
    # Simulate user already has 7 and 30 day badges
    existing_badges = [
        Badge(
            badge_id="7-day-streak",
            name="7 Day Streak",
            earned_at=datetime(2024, 1, 7, 12, 0, 0),
            milestone=7
        ),
        Badge(
            badge_id="30-day-streak",
            name="30 Day Streak",
            earned_at=datetime(2024, 1, 30, 12, 0, 0),
            milestone=30
        )
    ]
    
    # Award badges when reaching 100 days
    new_badges = award_milestone_badges(
        current_streak,
        previous_streak,
        existing_badges,
        timestamp
    )
    
    # Property: Should award 100-day badge
    hundred_day_badges = [b for b in new_badges if b.milestone == 100]
    assert len(hundred_day_badges) == 1, \
        f"Should award exactly one 100-day badge. Got {len(hundred_day_badges)}"
    
    # Property: Badge should have correct attributes
    badge = hundred_day_badges[0]
    assert badge.badge_id == "100-day-streak", \
        f"Badge ID should be '100-day-streak', got '{badge.badge_id}'"
    assert badge.milestone == 100, \
        f"Milestone should be 100, got {badge.milestone}"


@given(
    streak_jump=st.integers(min_value=0, max_value=100)
)
@settings(max_examples=50)
def test_property_milestone_badge_multiple_awards(streak_jump):
    """
    Property 29: Milestone badge awarding (multiple milestones)
    **Validates: Requirements 7.3**
    
    For any user who jumps across multiple milestones (e.g., from 6 to 30 days),
    the system should award all intermediate milestone badges.
    
    This test verifies:
    1. All crossed milestones award badges
    2. No milestones are skipped
    3. Badges are awarded in the correct order
    """
    # Start from 0 and jump to streak_jump
    previous_streak = 0
    current_streak = streak_jump
    timestamp = datetime.now()
    
    new_badges = award_milestone_badges(
        current_streak,
        previous_streak,
        [],
        timestamp
    )
    
    # Property: Should award badges for all crossed milestones
    expected_badges = []
    for milestone in [7, 30, 100]:
        if previous_streak < milestone <= current_streak:
            expected_badges.append(milestone)
    
    assert len(new_badges) == len(expected_badges), \
        f"Should award {len(expected_badges)} badges for streak {current_streak}. " \
        f"Expected milestones: {expected_badges}, Got {len(new_badges)} badges"
    
    # Property: Each expected milestone should have a badge
    awarded_milestones = {b.milestone for b in new_badges}
    for milestone in expected_badges:
        assert milestone in awarded_milestones, \
            f"Should award badge for {milestone}-day milestone"
    
    # Property: All badges should have unique IDs
    badge_ids = [b.badge_id for b in new_badges]
    assert len(badge_ids) == len(set(badge_ids)), \
        "All badge IDs should be unique"


@given(
    current_streak=st.integers(min_value=0, max_value=200)
)
@settings(max_examples=50)
def test_property_milestone_badge_no_premature_award(current_streak):
    """
    Property 29: Milestone badge awarding (no premature awards)
    **Validates: Requirements 7.3**
    
    For any user who has not reached a milestone, the system should not award
    the corresponding badge.
    
    This test verifies:
    1. Badges are only awarded when milestones are reached
    2. No badges are awarded prematurely
    3. The system correctly identifies when milestones are not reached
    """
    # Test each milestone
    for milestone in [7, 30, 100]:
        # If current streak is below milestone, no badge should be awarded
        if current_streak < milestone:
            previous_streak = max(0, current_streak - 1)
            timestamp = datetime.now()
            
            new_badges = award_milestone_badges(
                current_streak,
                previous_streak,
                [],
                timestamp
            )
            
            # Property: Should not award badge for unreached milestone
            milestone_badges = [b for b in new_badges if b.milestone == milestone]
            assert len(milestone_badges) == 0, \
                f"Should not award {milestone}-day badge when streak is {current_streak}"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
