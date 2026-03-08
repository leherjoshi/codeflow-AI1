# Progress Tracking API

## Overview

The Progress Tracking API provides endpoints to retrieve user progress data including streaks, badges, and daily problem-solving statistics.

## Endpoints

### GET /progress/{user_id}

Retrieves the current progress for a user, including:
- Current streak count
- Earned badges
- Problems solved today
- Total problems solved
- Last solve timestamp
- Next milestone information

#### Request

```
GET /api/v1/progress/{user_id}
```

**Path Parameters:**
- `user_id` (required): The unique identifier for the user

#### Response

**Success (200 OK):**

```json
{
  "user_id": "user-123",
  "streak_count": 5,
  "badges": [
    {
      "badge_id": "7-day-streak",
      "name": "7 Day Streak",
      "earned_at": "2024-01-10T12:00:00+00:00",
      "milestone": 7
    }
  ],
  "problems_solved_today": 3,
  "total_problems_solved": 42,
  "last_solve_timestamp": "2024-01-15T14:30:00+00:00",
  "next_milestone": {
    "days": 30,
    "badge_name": "30 Day Streak",
    "days_remaining": 25
  }
}
```

**New User (200 OK):**

```json
{
  "user_id": "new-user-456",
  "streak_count": 0,
  "badges": [],
  "problems_solved_today": 0,
  "total_problems_solved": 0,
  "last_solve_timestamp": null,
  "message": "No progress data yet. Start solving problems!"
}
```

**Error (400 Bad Request):**

```json
{
  "error": "Missing user_id"
}
```

**Error (500 Internal Server Error):**

```json
{
  "error": "Failed to fetch progress",
  "details": "Error message"
}
```

## Features

### Automatic Streak Reset

The endpoint automatically checks if the streak should be reset based on the last solve timestamp:
- If more than 24 hours have passed since the last solve, the streak is reset to 0
- The reset is persisted to DynamoDB automatically

### Badge Milestones

Badges are awarded at the following milestones:
- **7 Day Streak**: Awarded when streak reaches 7 days
- **30 Day Streak**: Awarded when streak reaches 30 days
- **100 Day Streak**: Awarded when streak reaches 100 days

### Next Milestone Calculation

The response includes information about the next milestone:
- Days required for the next badge
- Badge name
- Days remaining to reach the milestone

## Integration

This endpoint integrates with:
- **DynamoDB Progress Table**: Stores user progress data with composite key `user_id#date`
- **Progress Tracking Module**: Uses `progress_tracking.py` for streak calculation logic
- **AWS X-Ray**: Distributed tracing for performance monitoring

## Data Model

### Progress Table Schema

```
{
  "progress_id": "user_id#date",  // Partition key
  "user_id": "string",            // GSI partition key
  "date": "ISO date string",
  "streak_count": number,
  "badges": [Badge],
  "problems_solved_today": number,
  "total_problems_solved": number,
  "last_solve_timestamp": "ISO datetime string"
}
```

### Badge Schema

```
{
  "badge_id": "string",
  "name": "string",
  "earned_at": "ISO datetime string",
  "milestone": number
}
```

## Testing

Integration tests are available in `test_integration.py`:
- `test_get_progress_endpoint_with_data`: Tests retrieval with existing data
- `test_get_progress_endpoint_no_data`: Tests new user scenario
- `test_get_progress_endpoint_streak_reset`: Tests automatic streak reset
- `test_get_progress_missing_user_id`: Tests error handling

Run tests with:
```bash
python3 -m pytest test_integration.py -v -k progress
```

## Example Usage

### cURL

```bash
# Get progress for a user
curl -X GET https://api.codeflow.ai/api/v1/progress/user-123 \
  -H "Authorization: Bearer <jwt_token>"
```

### JavaScript (Fetch API)

```javascript
const response = await fetch('https://api.codeflow.ai/api/v1/progress/user-123', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  }
});

const progress = await response.json();
console.log(`Current streak: ${progress.streak_count} days`);
```

### Python (httpx)

```python
import httpx

async with httpx.AsyncClient() as client:
    response = await client.get(
        'https://api.codeflow.ai/api/v1/progress/user-123',
        headers={'Authorization': f'Bearer {jwt_token}'}
    )
    progress = response.json()
    print(f"Current streak: {progress['streak_count']} days")
```

## Notes

- The endpoint uses AWS X-Ray for distributed tracing
- CORS is configured to allow requests from the React frontend
- The endpoint is designed to be idempotent and safe for repeated calls
- Streak reset is performed automatically on GET requests to ensure data consistency
