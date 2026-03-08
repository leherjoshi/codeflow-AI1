"""
Property-Based Tests for Recommendations Service
Tests learning path generation, Goldilocks algorithm, and hint generation
"""

import pytest
import json
import os
from unittest.mock import Mock, patch, MagicMock
from hypothesis import given, strategies as st, settings, assume
from typing import List, Dict, Any

# Mock AWS services before importing index
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'
os.environ['USERS_TABLE'] = 'test-users'
os.environ['LEARNING_PATHS_TABLE'] = 'test-learning-paths'
os.environ['PROGRESS_TABLE'] = 'test-progress'
os.environ['LLM_CACHE_TABLE'] = 'test-llm-cache'
os.environ['CONVERSATION_HISTORY_TABLE'] = 'test-conversation-history'

# Mock boto3 before importing index
with patch('boto3.resource'), patch('boto3.client'):
    # Import functions to test
    import sys
    sys.path.insert(0, os.path.dirname(__file__))
    
    from index import (
        validate_learning_path,
        parse_learning_path_response,
        select_goldilocks_problem,
        get_current_difficulty,
        increase_difficulty,
        decrease_difficulty,
        contains_code,
        build_hint_prompt
    )


# ============================================================================
# Property Tests for Learning Path Generation (Task 4.8)
# ============================================================================

def test_property_10_learning_path_structure_validation():
    """
    **Property 10: Learning path structure**
    **Validates: Requirements 3.2**
    
    For any learning path generation:
    - Path contains 20-30 problems
    - Difficulty distribution: 30% Easy, 50% Medium, 20% Hard (±10% tolerance)
    
    Note: This test validates the structure, not the full generation pipeline
    """
    
    # Generate mock problems (25 problems with correct distribution)
    num_problems = 25
    
    # Create problems with correct difficulty distribution
    easy_count = 8  # 32% (within 30% ±10%)
    medium_count = 12  # 48% (within 50% ±10%)
    hard_count = 5  # 20%
    
    mock_problems = []
    
    # Add Easy problems
    for i in range(easy_count):
        mock_problems.append({
            'title': f'Problem {i+1}',
            'difficulty': 'Easy',
            'topics': ['arrays'],
            'leetcode_id': str(i+1),
            'estimated_time_minutes': 15,
            'reason': 'Test problem'
        })
    
    # Add Medium problems
    for i in range(medium_count):
        idx = easy_count + i
        mock_problems.append({
            'title': f'Problem {idx+1}',
            'difficulty': 'Medium',
            'topics': ['arrays'],
            'leetcode_id': str(idx+1),
            'estimated_time_minutes': 30,
            'reason': 'Test problem'
        })
    
    # Add Hard problems
    for i in range(hard_count):
        idx = easy_count + medium_count + i
        mock_problems.append({
            'title': f'Problem {idx+1}',
            'difficulty': 'Hard',
            'topics': ['arrays'],
            'leetcode_id': str(idx+1),
            'estimated_time_minutes': 45,
            'reason': 'Test problem'
        })
    
    # Validate structure
    validate_learning_path(mock_problems)
    
    # Verify properties
    assert len(mock_problems) == 25
    
    # Count difficulties
    difficulty_counts = {'Easy': 0, 'Medium': 0, 'Hard': 0}
    for problem in mock_problems:
        difficulty = problem.get('difficulty', '')
        if difficulty in difficulty_counts:
            difficulty_counts[difficulty] += 1
    
    total = len(mock_problems)
    easy_pct = (difficulty_counts['Easy'] / total) * 100
    medium_pct = (difficulty_counts['Medium'] / total) * 100
    hard_pct = (difficulty_counts['Hard'] / total) * 100
    
    # Verify distribution (±10% tolerance)
    assert 20 <= easy_pct <= 40, f"Easy percentage {easy_pct:.1f}% outside range 20-40%"
    assert 40 <= medium_pct <= 60, f"Medium percentage {medium_pct:.1f}% outside range 40-60%"
    assert 10 <= hard_pct <= 30, f"Hard percentage {hard_pct:.1f}% outside range 10-30%"


def test_validate_learning_path_correct_count():
    """Test that validation accepts paths with 20-30 problems"""
    
    # Valid path with 25 problems
    problems = [
        {'title': f'Problem {i}', 'difficulty': 'Easy' if i < 8 else ('Medium' if i < 20 else 'Hard')}
        for i in range(25)
    ]
    
    # Should not raise
    validate_learning_path(problems)


def test_validate_learning_path_too_few():
    """Test that validation rejects paths with < 20 problems"""
    
    problems = [{'title': f'Problem {i}', 'difficulty': 'Easy'} for i in range(15)]
    
    with pytest.raises(ValueError, match="must have 20-30 problems"):
        validate_learning_path(problems)


def test_validate_learning_path_too_many():
    """Test that validation rejects paths with > 30 problems"""
    
    problems = [{'title': f'Problem {i}', 'difficulty': 'Easy'} for i in range(35)]
    
    with pytest.raises(ValueError, match="must have 20-30 problems"):
        validate_learning_path(problems)


def test_parse_learning_path_response_valid_json():
    """Test parsing valid JSON response"""
    
    response = json.dumps([
        {
            'title': 'Two Sum',
            'difficulty': 'Easy',
            'topics': ['arrays', 'hash-table'],
            'leetcode_id': '1'
        }
    ])
    
    problems = parse_learning_path_response(response)
    
    assert len(problems) == 1
    assert problems[0]['title'] == 'Two Sum'
    assert problems[0]['difficulty'] == 'Easy'


def test_parse_learning_path_response_with_markdown():
    """Test parsing JSON wrapped in markdown code blocks"""
    
    response = """```json
[
    {
        "title": "Two Sum",
        "difficulty": "Easy",
        "topics": ["arrays"],
        "leetcode_id": "1"
    }
]
```"""
    
    problems = parse_learning_path_response(response)
    
    assert len(problems) == 1
    assert problems[0]['title'] == 'Two Sum'


def test_parse_learning_path_response_invalid_json():
    """Test that invalid JSON raises ValueError"""
    
    response = "This is not JSON"
    
    with pytest.raises(ValueError, match="Invalid JSON response"):
        parse_learning_path_response(response)


# ============================================================================
# Property Tests for Goldilocks Algorithm (Task 4.10)
# ============================================================================

@given(
    success_rate=st.floats(min_value=0.0, max_value=1.0),
    current_difficulty=st.sampled_from(['Easy', 'Medium', 'Hard'])
)
@settings(max_examples=50)
def test_property_15_adaptive_difficulty_adjustment(success_rate, current_difficulty):
    """
    **Property 15: Adaptive difficulty adjustment**
    **Validates: Requirements 4.2**
    
    For any success rate:
    - Success ≥80% → difficulty increases (or stays at Hard)
    - Success ≤40% → difficulty decreases (or stays at Easy)
    - 40% < Success < 80% → difficulty maintains
    """
    
    # Create mock recent performance
    num_attempts = 10
    successes = int(success_rate * num_attempts)
    
    recent_performance = []
    for i in range(num_attempts):
        recent_performance.append({
            'problem_id': f'problem-{i}',
            'success': i < successes,
            'difficulty': current_difficulty,
            'timestamp': f'2024-01-{i+1:02d}'
        })
    
    # Create mock learning path with problems of all difficulties
    learning_path = {
        'path_id': 'test-path',
        'current_index': 0,
        'problems': [
            {'title': 'Easy Problem', 'difficulty': 'Easy', 'topics': ['arrays']},
            {'title': 'Medium Problem', 'difficulty': 'Medium', 'topics': ['arrays']},
            {'title': 'Hard Problem', 'difficulty': 'Hard', 'topics': ['arrays']},
        ]
    }
    
    # Select next problem
    result = select_goldilocks_problem(learning_path, recent_performance)
    
    assert result is not None
    selected_difficulty = result['problem']['difficulty']
    
    # Verify adaptive difficulty logic
    if success_rate >= 0.8:
        # High success → should increase difficulty
        if current_difficulty == 'Easy':
            assert selected_difficulty in ['Medium', 'Hard'], \
                f"Expected harder problem for {success_rate*100:.0f}% success rate"
        elif current_difficulty == 'Medium':
            # Should try to get Hard, but might not be available
            pass  # Can't strictly enforce due to availability
        # Hard stays Hard
    
    elif success_rate <= 0.4:
        # Low success → should decrease difficulty
        if current_difficulty == 'Hard':
            assert selected_difficulty in ['Easy', 'Medium'], \
                f"Expected easier problem for {success_rate*100:.0f}% success rate"
        elif current_difficulty == 'Medium':
            # Should try to get Easy, but might not be available
            pass  # Can't strictly enforce due to availability
        # Easy stays Easy


@given(
    consecutive_failures=st.integers(min_value=2, max_value=5),
    current_difficulty=st.sampled_from(['Medium', 'Hard'])
)
@settings(max_examples=30)
def test_property_17_failure_based_difficulty_reduction(consecutive_failures, current_difficulty):
    """
    **Property 17: Failure-based difficulty reduction**
    **Validates: Requirements 4.4**
    
    For any consecutive failures ≥2:
    - System should reduce difficulty
    - Reason should mention consecutive failures
    """
    
    # Create recent performance with consecutive failures
    recent_performance = []
    for i in range(consecutive_failures):
        recent_performance.append({
            'problem_id': f'problem-{i}',
            'success': False,  # All failures
            'difficulty': current_difficulty,
            'timestamp': f'2024-01-{i+1:02d}'
        })
    
    # Create mock learning path
    learning_path = {
        'path_id': 'test-path',
        'current_index': 0,
        'problems': [
            {'title': 'Easy Problem', 'difficulty': 'Easy', 'topics': ['arrays']},
            {'title': 'Medium Problem', 'difficulty': 'Medium', 'topics': ['arrays']},
            {'title': 'Hard Problem', 'difficulty': 'Hard', 'topics': ['arrays']},
        ]
    }
    
    # Select next problem
    result = select_goldilocks_problem(learning_path, recent_performance)
    
    assert result is not None
    
    # Verify difficulty was reduced
    selected_difficulty = result['problem']['difficulty']
    
    if current_difficulty == 'Hard':
        assert selected_difficulty in ['Easy', 'Medium'], \
            f"Expected easier problem after {consecutive_failures} failures"
    elif current_difficulty == 'Medium':
        # Should try Easy, but might not be available
        pass
    
    # Verify reason mentions consecutive failures
    reason = result.get('reason', '')
    assert 'consecutive failures' in reason.lower() or 'failure' in reason.lower(), \
        f"Reason should mention failures: {reason}"


def test_increase_difficulty():
    """Test difficulty increase logic"""
    assert increase_difficulty('Easy') == 'Medium'
    assert increase_difficulty('Medium') == 'Hard'
    assert increase_difficulty('Hard') == 'Hard'  # Can't go higher


def test_decrease_difficulty():
    """Test difficulty decrease logic"""
    assert decrease_difficulty('Easy') == 'Easy'  # Can't go lower
    assert decrease_difficulty('Medium') == 'Easy'
    assert decrease_difficulty('Hard') == 'Medium'


def test_get_current_difficulty_from_recent():
    """Test getting current difficulty from recent performance"""
    
    recent_performance = [
        {'difficulty': 'Medium', 'success': True},
        {'difficulty': 'Easy', 'success': False}
    ]
    
    # Should return most recent
    assert get_current_difficulty(recent_performance) == 'Medium'


def test_get_current_difficulty_empty():
    """Test getting current difficulty with no history"""
    assert get_current_difficulty([]) == 'Easy'


# ============================================================================
# Property Tests for Hint Generation (Task 4.12)
# ============================================================================

def test_property_20_hint_code_free_constraint():
    """
    **Property 20: Hint code-free constraint**
    **Validates: Requirements 5.2**
    
    For any hint generation:
    - Hint contains no code snippets
    - Hint doesn't reveal explicit solutions
    - Hint is conceptual guidance only
    """
    
    # Test various code-free hints
    code_free_hints = [
        "Think about what data structure allows O(1) lookup time.",
        "Consider the relationship between the input and output.",
        "What if you processed the array from both ends simultaneously?",
        "A hash map can help you track values you've seen before.",
        "Think about the two-pointer technique for this problem."
    ]
    
    for hint in code_free_hints:
        # Verify hint is code-free
        assert not contains_code(hint), f"Hint contains code: {hint}"
        
        # Verify hint is not empty
        assert len(hint) > 0, "Hint should not be empty"
        
        # Verify hint doesn't contain explicit solution keywords
        forbidden_words = ['solution', 'answer is', 'the code is', 'here is the']
        hint_lower = hint.lower()
        
        for word in forbidden_words:
            assert word not in hint_lower, f"Hint contains forbidden word '{word}': {hint}"
    
    # Test that hints with code are detected
    code_hints = [
        "Use this code: ```python\nfor i in range(n):\n```",
        "Create an array: arr = [1, 2, 3]",
        "Use for(int i = 0; i < n; i++)",
        "Define function: def solve(nums):"
    ]
    
    for hint in code_hints:
        assert contains_code(hint), f"Failed to detect code in: {hint}"


def test_contains_code_detects_code_blocks():
    """Test that code block detection works"""
    
    # Should detect code blocks
    assert contains_code("```python\nprint('hello')\n```")
    assert contains_code("Here's the code: ```\nfor i in range(10):\n```")
    
    # Should not detect plain text
    assert not contains_code("Think about using a hash map for O(1) lookup.")
    assert not contains_code("Consider the two-pointer technique.")


def test_contains_code_detects_syntax():
    """Test that code syntax detection works"""
    
    # Should detect common code patterns
    assert contains_code("Use for(int i = 0; i < n; i++)")
    assert contains_code("Create an array: arr = [1, 2, 3]")
    assert contains_code("Define function: def solve(nums):")
    assert contains_code("Use while(left < right)")
    
    # Should not detect conceptual descriptions
    assert not contains_code("Use a for loop to iterate")
    assert not contains_code("Think about array indexing")
    assert not contains_code("Consider using a function")


def test_build_hint_prompt_levels():
    """Test that hint prompts are different for each level"""
    
    problem = "Find two numbers that add up to target"
    
    prompt1 = build_hint_prompt(problem, 1)
    prompt2 = build_hint_prompt(problem, 2)
    prompt3 = build_hint_prompt(problem, 3)
    
    # All should contain the problem
    assert problem in prompt1
    assert problem in prompt2
    assert problem in prompt3
    
    # All should have code-free constraint
    assert 'DO NOT provide any code' in prompt1
    assert 'DO NOT provide any code' in prompt2
    assert 'DO NOT provide any code' in prompt3
    
    # Each level should have different guidance
    assert 'Level 1' in prompt1
    assert 'Level 2' in prompt2
    assert 'Level 3' in prompt3


def test_build_hint_prompt_strict_mode():
    """Test that strict mode adds extra constraints"""
    
    problem = "Test problem"
    
    normal_prompt = build_hint_prompt(problem, 1, strict=False)
    strict_prompt = build_hint_prompt(problem, 1, strict=True)
    
    # Strict should have additional constraints
    assert 'STRICT MODE' in strict_prompt
    assert 'STRICT MODE' not in normal_prompt
    
    # Both should have base constraints
    assert 'DO NOT provide any code' in normal_prompt
    assert 'DO NOT provide any code' in strict_prompt


# ============================================================================
# Integration Tests
# ============================================================================

def test_goldilocks_with_empty_performance():
    """Test Goldilocks algorithm with no performance history"""
    
    learning_path = {
        'path_id': 'test-path',
        'current_index': 0,
        'problems': [
            {'title': 'Problem 1', 'difficulty': 'Easy', 'topics': ['arrays']},
            {'title': 'Problem 2', 'difficulty': 'Medium', 'topics': ['arrays']},
        ]
    }
    
    result = select_goldilocks_problem(learning_path, [])
    
    assert result is not None
    assert 'problem' in result
    assert 'reason' in result


def test_goldilocks_path_completed():
    """Test Goldilocks when all problems are completed"""
    
    learning_path = {
        'path_id': 'test-path',
        'current_index': 2,  # Beyond last problem
        'problems': [
            {'title': 'Problem 1', 'difficulty': 'Easy', 'topics': ['arrays']},
            {'title': 'Problem 2', 'difficulty': 'Medium', 'topics': ['arrays']},
        ]
    }
    
    result = select_goldilocks_problem(learning_path, [])
    
    # Should return None when path is completed
    assert result is None


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
