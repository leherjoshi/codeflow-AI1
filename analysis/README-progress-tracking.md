# Progress Tracking Module

This module implements the streak logic and badge awarding system for the CodeFlow AI platform.

## Overview

The progress tracking system monitors user activity and maintains streak counts based on daily problem-solving behavior. It awards milestone badges at 7, 30, and 100-day streaks.

## Components

### `progress_tracking.py`

Core module containing the streak calculation and badge awarding logic.

**Key Functions:**

- `calculate_streak_increment()` - Calculates new streak count when a user solves a problem
- `check_streak_reset()` - Checks if a streak should be reset due to inactivity
- `award_milestone_badges()` - Awards badges when users reach milestone streaks
- `update_progress()` - Main orchestration function for updating user progress

**Data Models:**

- `Badge` - Represents a milestone badge with ID, name, earned timestamp, and milestone value
- `Progress` - Represents user progress with streak count, badges, and activity data

### `test_progress_tracking.py`

Comprehensive test suite with both unit tests and property-based tests using Hypothesis.

**Property Tests:**

1. **Property 27: Streak increment on daily solve** (Validates Requirements 7.1)
   - Tests that streaks increment by exactly 1 when solving within 24 hours
   - Verifies consistency across all streak values and time windows

2. **Property 28: Streak reset on missed day** (Validates Requirements 7.2)
   - Tests that streaks reset to 0 after 24+ hours of inactivity
   - Verifies reset behavior for both passive checks and active solves

3. **Property 29: Milestone badge awarding** (Validates Requirements 7.3)
   - Tests badge awarding at 7, 30, and 100-day milestones
   - Verifies no duplicate badges and correct handling of milestone jumps

## Streak Logic Rules

### Streak Increment
- **First solve**: Streak starts at 1
- **Within 24 hours**: Streak increments by 1
- **After 24+ hours**: Streak resets to 1

### Streak Reset
- If a user doesn't solve any problems for more than 24 hours, their streak resets to 0
- When they solve the next problem, the streak restarts at 1

### Badge Awarding
- **7-day streak**: Awarded when reaching 7 consecutive days
- **30-day streak**: Awarded when reaching 30 consecutive days
- **100-day streak**: Awarded when reaching 100 consecutive days
- Badges are awarded only once per milestone
- If a user jumps multiple milestones (e.g., 6 to 30 days), all intermediate badges are awarded

## Running Tests

### Install Dependencies

```bash
pip install -r requirements-dev.txt
```

### Run All Tests

```bash
pytest test_progress_tracking.py -v
```

### Run Only Property Tests

```bash
pytest test_progress_tracking.py -v -k "property"
```

### Run with Coverage

```bash
pytest test_progress_tracking.py --cov=progress_tracking --cov-report=html
```

## Test Results

All 21 tests pass successfully:
- 12 unit tests covering basic functionality
- 9 property-based tests covering the three main properties with 100+ examples each

**Property Test Coverage:**
- Property 27: 200 examples tested (streak increment scenarios)
- Property 28: 200 examples tested (streak reset scenarios)
- Property 29: 200 examples tested (badge awarding scenarios)

## Integration with DynamoDB

The progress tracking module is designed to work with the DynamoDB Progress table:

**Table Schema:**
- **PK**: `progress_id` (format: `user_id#date`)
- **GSI**: `user_id` (for querying all progress records for a user)
- **Attributes**: `streak_count`, `badges`, `problems_solved`, `topics_practiced`, `last_solve_timestamp`

## Next Steps

1. Integrate this module into the Analysis Lambda function
2. Add API endpoints for progress tracking:
   - `GET /api/v1/progress/{user_id}` - Get overall progress stats
   - `POST /api/v1/progress/{user_id}/update` - Record problem completion
   - `GET /api/v1/progress/{user_id}/streak` - Get current streak and badges
3. Add EventBridge integration to trigger progress updates on problem completion
4. Implement frontend UI components to display streaks and badges
