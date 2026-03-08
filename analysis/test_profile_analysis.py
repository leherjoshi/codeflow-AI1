"""
Unit tests for profile analysis service
Tests topic proficiency calculation and classification logic
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
import json
from datetime import datetime, timezone
import sys
import os
from hypothesis import given, strategies as st, settings, assume

# Set environment variables before importing
os.environ['USERS_TABLE'] = 'test-users-table'
os.environ['PROGRESS_TABLE'] = 'test-progress-table'
os.environ['ANALYTICS_TABLE'] = 'test-analytics-table'
os.environ['EVENT_BUS_NAME'] = 'test-event-bus'
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'

# Mock AWS services before importing index
sys.path.insert(0, os.path.dirname(__file__))

# Mock boto3 and AWS services
with patch('boto3.resource'), patch('boto3.client'):
    from index import (
        calculate_topic_proficiency_from_summary,
        calculate_topic_proficiency_from_submissions,
        classify_topics,
        generate_skill_heatmap,
        handle_analyze_profile
    )


class TestTopicProficiencyCalculation:
    """Test topic proficiency calculation logic"""
    
    def test_advanced_topic_strong_proficiency(self):
        """Test advanced topic with 5+ problems solved = strong (>70%)"""
        topics = [
            {'slug': 'dynamic-programming', 'problems_solved': 5, 'level': 'advanced'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert 'dynamic-programming' in result
        assert result['dynamic-programming'] >= 70
    
    def test_advanced_topic_moderate_proficiency(self):
        """Test advanced topic with 2-4 problems = moderate (40-70%)"""
        topics = [
            {'slug': 'graph-theory', 'problems_solved': 3, 'level': 'advanced'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert 'graph-theory' in result
        assert 40 <= result['graph-theory'] <= 70
    
    def test_advanced_topic_weak_proficiency(self):
        """Test advanced topic with <2 problems = weak (<40%)"""
        topics = [
            {'slug': 'segment-tree', 'problems_solved': 1, 'level': 'advanced'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert 'segment-tree' in result
        assert result['segment-tree'] < 40
    
    def test_intermediate_topic_proficiency(self):
        """Test intermediate topic proficiency calculation"""
        topics = [
            {'slug': 'binary-search', 'problems_solved': 8, 'level': 'intermediate'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert 'binary-search' in result
        assert result['binary-search'] >= 70
    
    def test_fundamental_topic_proficiency(self):
        """Test fundamental topic proficiency calculation"""
        topics = [
            {'slug': 'arrays', 'problems_solved': 10, 'level': 'fundamental'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert 'arrays' in result
        assert result['arrays'] >= 70
    
    def test_multiple_topics(self):
        """Test proficiency calculation for multiple topics"""
        topics = [
            {'slug': 'arrays', 'problems_solved': 15, 'level': 'fundamental'},
            {'slug': 'dynamic-programming', 'problems_solved': 2, 'level': 'advanced'},
            {'slug': 'binary-search', 'problems_solved': 5, 'level': 'intermediate'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert len(result) == 3
        assert 'arrays' in result
        assert 'dynamic-programming' in result
        assert 'binary-search' in result
    
    def test_zero_problems_solved(self):
        """Test topic with zero problems solved"""
        topics = [
            {'slug': 'trie', 'problems_solved': 0, 'level': 'advanced'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert 'trie' in result
        assert result['trie'] == 0
    
    def test_proficiency_capped_at_100(self):
        """Test that proficiency is capped at 100%"""
        topics = [
            {'slug': 'arrays', 'problems_solved': 100, 'level': 'fundamental'}
        ]
        
        result = calculate_topic_proficiency_from_summary(topics)
        
        assert result['arrays'] <= 100


class TestSubmissionBasedProficiencyCalculation:
    """Test proficiency calculation from submission history"""
    
    def test_proficiency_from_submissions_50_percent(self):
        """Test proficiency = (solved/attempted) × 100 = 50%"""
        submissions = [
            {'topics': ['arrays'], 'status': 'Accepted'},
            {'topics': ['arrays'], 'status': 'Wrong Answer'},
            {'topics': ['arrays'], 'status': 'Accepted'},
            {'topics': ['arrays'], 'status': 'Time Limit Exceeded'}
        ]
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        assert 'arrays' in result
        assert result['arrays'] == 50.0
    
    def test_proficiency_from_submissions_100_percent(self):
        """Test proficiency = 100% when all submissions accepted"""
        submissions = [
            {'topics': ['dynamic-programming'], 'status': 'Accepted'},
            {'topics': ['dynamic-programming'], 'status': 'Accepted'},
            {'topics': ['dynamic-programming'], 'status': 'Accepted'}
        ]
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        assert 'dynamic-programming' in result
        assert result['dynamic-programming'] == 100.0
    
    def test_proficiency_from_submissions_0_percent(self):
        """Test proficiency = 0% when no submissions accepted"""
        submissions = [
            {'topics': ['graphs'], 'status': 'Wrong Answer'},
            {'topics': ['graphs'], 'status': 'Time Limit Exceeded'}
        ]
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        assert 'graphs' in result
        assert result['graphs'] == 0.0
    
    def test_proficiency_multiple_topics_per_submission(self):
        """Test submissions with multiple topics"""
        submissions = [
            {'topics': ['arrays', 'two-pointers'], 'status': 'Accepted'},
            {'topics': ['arrays', 'sorting'], 'status': 'Wrong Answer'},
            {'topics': ['two-pointers'], 'status': 'Accepted'}
        ]
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        # arrays: 1 accepted / 2 attempted = 50%
        assert result['arrays'] == 50.0
        # two-pointers: 2 accepted / 2 attempted = 100%
        assert result['two-pointers'] == 100.0
        # sorting: 0 accepted / 1 attempted = 0%
        assert result['sorting'] == 0.0
    
    def test_proficiency_with_dict_topics(self):
        """Test submissions with topic dictionaries"""
        submissions = [
            {'topics': [{'slug': 'arrays', 'name': 'Arrays'}], 'status': 'Accepted'},
            {'topics': [{'slug': 'arrays', 'name': 'Arrays'}], 'status': 'Wrong Answer'}
        ]
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        assert 'arrays' in result
        assert result['arrays'] == 50.0
    
    def test_proficiency_empty_submissions(self):
        """Test with empty submissions list"""
        submissions = []
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        assert result == {}
    
    def test_proficiency_submissions_without_topics(self):
        """Test submissions without topic data (should return empty)"""
        submissions = [
            {'status': 'Accepted'},
            {'status': 'Wrong Answer'}
        ]
        
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        assert result == {}


class TestTopicClassification:
    """Test topic classification logic"""
    
    def test_weak_classification(self):
        """Test topics with <40% proficiency are classified as weak"""
        topic_proficiency = {
            'dynamic-programming': 35.0,
            'graph-theory': 20.0
        }
        
        result = classify_topics(topic_proficiency)
        
        assert result['dynamic-programming']['classification'] == 'weak'
        assert result['graph-theory']['classification'] == 'weak'
    
    def test_moderate_classification(self):
        """Test topics with 40-70% proficiency are classified as moderate"""
        topic_proficiency = {
            'binary-search': 55.0,
            'two-pointers': 65.0
        }
        
        result = classify_topics(topic_proficiency)
        
        assert result['binary-search']['classification'] == 'moderate'
        assert result['two-pointers']['classification'] == 'moderate'
    
    def test_strong_classification(self):
        """Test topics with >70% proficiency are classified as strong"""
        topic_proficiency = {
            'arrays': 85.0,
            'strings': 95.0
        }
        
        result = classify_topics(topic_proficiency)
        
        assert result['arrays']['classification'] == 'strong'
        assert result['strings']['classification'] == 'strong'
    
    def test_boundary_values(self):
        """Test classification at boundary values"""
        topic_proficiency = {
            'topic1': 39.99,  # weak
            'topic2': 40.0,   # moderate
            'topic3': 70.0,   # moderate
            'topic4': 70.01   # strong
        }
        
        result = classify_topics(topic_proficiency)
        
        assert result['topic1']['classification'] == 'weak'
        assert result['topic2']['classification'] == 'moderate'
        assert result['topic3']['classification'] == 'moderate'
        assert result['topic4']['classification'] == 'strong'
    
    def test_proficiency_preserved(self):
        """Test that proficiency values are preserved in classification"""
        topic_proficiency = {
            'arrays': 75.5,
            'dynamic-programming': 35.2
        }
        
        result = classify_topics(topic_proficiency)
        
        assert result['arrays']['proficiency'] == 75.5
        assert result['dynamic-programming']['proficiency'] == 35.2


class TestSkillHeatmapGeneration:
    """Test skill heatmap data structure generation"""
    
    def test_heatmap_structure(self):
        """Test heatmap has correct structure"""
        classified_topics = {
            'arrays': {'proficiency': 85.0, 'classification': 'strong'},
            'dynamic-programming': {'proficiency': 35.0, 'classification': 'weak'},
            'binary-search': {'proficiency': 55.0, 'classification': 'moderate'}
        }
        
        result = generate_skill_heatmap(classified_topics)
        
        assert 'weak' in result
        assert 'moderate' in result
        assert 'strong' in result
        assert 'all_topics' in result
    
    def test_topics_grouped_by_classification(self):
        """Test topics are correctly grouped by classification"""
        classified_topics = {
            'arrays': {'proficiency': 85.0, 'classification': 'strong'},
            'strings': {'proficiency': 90.0, 'classification': 'strong'},
            'dynamic-programming': {'proficiency': 35.0, 'classification': 'weak'},
            'graphs': {'proficiency': 25.0, 'classification': 'weak'},
            'binary-search': {'proficiency': 55.0, 'classification': 'moderate'}
        }
        
        result = generate_skill_heatmap(classified_topics)
        
        assert len(result['weak']) == 2
        assert len(result['moderate']) == 1
        assert len(result['strong']) == 2
    
    def test_topics_sorted_within_groups(self):
        """Test topics are sorted by proficiency within each group"""
        classified_topics = {
            'arrays': {'proficiency': 85.0, 'classification': 'strong'},
            'strings': {'proficiency': 95.0, 'classification': 'strong'},
            'dynamic-programming': {'proficiency': 35.0, 'classification': 'weak'},
            'graphs': {'proficiency': 20.0, 'classification': 'weak'}
        }
        
        result = generate_skill_heatmap(classified_topics)
        
        # Weak topics sorted ascending
        assert result['weak'][0]['proficiency'] < result['weak'][1]['proficiency']
        
        # Strong topics sorted descending
        assert result['strong'][0]['proficiency'] > result['strong'][1]['proficiency']
    
    def test_all_topics_sorted_descending(self):
        """Test all_topics list is sorted by proficiency descending"""
        classified_topics = {
            'arrays': {'proficiency': 85.0, 'classification': 'strong'},
            'dynamic-programming': {'proficiency': 35.0, 'classification': 'weak'},
            'binary-search': {'proficiency': 55.0, 'classification': 'moderate'}
        }
        
        result = generate_skill_heatmap(classified_topics)
        
        all_topics = result['all_topics']
        assert len(all_topics) == 3
        assert all_topics[0]['proficiency'] >= all_topics[1]['proficiency']
        assert all_topics[1]['proficiency'] >= all_topics[2]['proficiency']


class TestAnalyzeProfileEndpoint:
    """Test the analyze profile endpoint handler"""
    
    @patch('index.fetch_user_profile')
    @patch('index.store_analysis_results')
    @patch('index.publish_analysis_complete_event')
    def test_successful_analysis(self, mock_publish, mock_store, mock_fetch):
        """Test successful profile analysis"""
        # Mock user data
        mock_fetch.return_value = {
            'user_id': 'test-user-123',
            'leetcode_profile': {
                'topics': [
                    {'slug': 'arrays', 'problems_solved': 15, 'level': 'fundamental'},
                    {'slug': 'dynamic-programming', 'problems_solved': 2, 'level': 'advanced'}
                ]
            }
        }
        
        body = {
            'user_id': 'test-user-123',
            'leetcode_username': 'testuser'
        }
        
        result = handle_analyze_profile(body)
        
        assert result['statusCode'] == 200
        response_body = json.loads(result['body'])
        assert response_body['message'] == 'Profile analysis complete'
        assert 'topics' in response_body
        assert 'heatmap' in response_body
        assert 'summary' in response_body
        
        # Verify helper functions were called
        mock_fetch.assert_called_once_with('test-user-123')
        mock_store.assert_called_once()
        mock_publish.assert_called_once()
    
    def test_missing_user_id(self):
        """Test error when user_id is missing"""
        body = {'leetcode_username': 'testuser'}
        
        result = handle_analyze_profile(body)
        
        assert result['statusCode'] == 400
        response_body = json.loads(result['body'])
        assert 'error' in response_body
    
    def test_missing_leetcode_username(self):
        """Test error when leetcode_username is missing"""
        body = {'user_id': 'test-user-123'}
        
        result = handle_analyze_profile(body)
        
        assert result['statusCode'] == 400
        response_body = json.loads(result['body'])
        assert 'error' in response_body
    
    @patch('index.fetch_user_profile')
    def test_profile_not_found(self, mock_fetch):
        """Test error when profile is not found"""
        mock_fetch.return_value = None
        
        body = {
            'user_id': 'test-user-123',
            'leetcode_username': 'testuser'
        }
        
        result = handle_analyze_profile(body)
        
        assert result['statusCode'] == 404
        response_body = json.loads(result['body'])
        assert 'error' in response_body
    
    @patch('index.fetch_user_profile')
    def test_profile_missing_leetcode_data(self, mock_fetch):
        """Test error when profile exists but has no leetcode_profile data"""
        mock_fetch.return_value = {'user_id': 'test-user-123'}
        
        body = {
            'user_id': 'test-user-123',
            'leetcode_username': 'testuser'
        }
        
        result = handle_analyze_profile(body)
        
        assert result['statusCode'] == 404
        response_body = json.loads(result['body'])
        assert 'error' in response_body


if __name__ == '__main__':
    pytest.main([__file__, '-v'])


# ============================================================================
# Property-Based Tests
# ============================================================================

class TestProficiencyCalculationProperties:
    """
    Property-based tests for proficiency calculation
    Using Hypothesis to test properties across many inputs
    """
    
    @given(
        solved=st.integers(min_value=0, max_value=1000),
        attempted=st.integers(min_value=1, max_value=1000)
    )
    @settings(max_examples=100)
    def test_property_6_proficiency_calculation_formula(self, solved, attempted):
        """
        **Property 6: Topic proficiency calculation**
        **Validates: Requirements 2.2**
        
        For any set of submissions for a topic, the proficiency score should equal
        (solved_count / attempted_count) × 100.
        
        This property tests that the proficiency calculation formula is correctly
        applied for all valid inputs.
        """
        # Ensure solved <= attempted (valid constraint)
        assume(solved <= attempted)
        
        # Create submissions with the specified solved/attempted ratio
        submissions = []
        
        # Add solved submissions
        for i in range(solved):
            submissions.append({
                'topics': ['test-topic'],
                'status': 'Accepted'
            })
        
        # Add failed submissions
        for i in range(attempted - solved):
            submissions.append({
                'topics': ['test-topic'],
                'status': 'Wrong Answer'
            })
        
        # Calculate proficiency
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        # Expected proficiency
        expected_proficiency = (solved / attempted) * 100
        
        # Verify the formula is correctly applied
        assert 'test-topic' in result
        assert abs(result['test-topic'] - expected_proficiency) < 0.01, \
            f"Expected {expected_proficiency}, got {result['test-topic']}"
        
        # Verify proficiency is in valid range [0, 100]
        assert 0 <= result['test-topic'] <= 100
    
    @given(
        proficiency=st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
    )
    @settings(max_examples=100)
    def test_property_7_classification_thresholds(self, proficiency):
        """
        **Property 7: Topic classification rules**
        **Validates: Requirements 2.3, 2.4**
        
        For any topic with calculated proficiency:
        - Topics with score < 40% should be classified as "Weak"
        - Topics with score > 70% should be classified as "Strong"
        - All others (40% <= score <= 70%) should be classified as "Moderate"
        
        This property tests that classification thresholds are correctly applied.
        """
        # Create topic proficiency dict
        topic_proficiency = {
            'test-topic': proficiency
        }
        
        # Classify topics
        result = classify_topics(topic_proficiency)
        
        # Verify classification based on thresholds
        assert 'test-topic' in result
        classification = result['test-topic']['classification']
        
        if proficiency < 40:
            assert classification == 'weak', \
                f"Proficiency {proficiency} should be classified as 'weak', got '{classification}'"
        elif proficiency > 70:
            assert classification == 'strong', \
                f"Proficiency {proficiency} should be classified as 'strong', got '{classification}'"
        else:
            assert classification == 'moderate', \
                f"Proficiency {proficiency} should be classified as 'moderate', got '{classification}'"
        
        # Verify proficiency value is preserved
        assert result['test-topic']['proficiency'] == proficiency
    
    @given(
        topics_data=st.lists(
            st.tuples(
                st.text(min_size=1, max_size=30, alphabet=st.characters(whitelist_categories=('Ll', 'Lu', 'Nd'), whitelist_characters='-_')),
                st.integers(min_value=0, max_value=100),
                st.integers(min_value=1, max_value=100)
            ),
            min_size=1,
            max_size=20,
            unique_by=lambda x: x[0]  # Ensure unique topic names
        )
    )
    @settings(max_examples=100)
    def test_property_6_multiple_topics(self, topics_data):
        """
        **Property 6: Topic proficiency calculation (multiple topics)**
        **Validates: Requirements 2.2**
        
        Test proficiency calculation for multiple topics simultaneously.
        Each topic should have its proficiency calculated independently.
        """
        # Filter out invalid data
        valid_topics = [(name, solved, attempted) for name, solved, attempted in topics_data 
                       if solved <= attempted and name.strip()]
        
        assume(len(valid_topics) > 0)
        
        # Create submissions for all topics
        submissions = []
        expected_proficiencies = {}
        
        for topic_name, solved, attempted in valid_topics:
            # Add solved submissions
            for i in range(solved):
                submissions.append({
                    'topics': [topic_name],
                    'status': 'Accepted'
                })
            
            # Add failed submissions
            for i in range(attempted - solved):
                submissions.append({
                    'topics': [topic_name],
                    'status': 'Wrong Answer'
                })
            
            # Calculate expected proficiency
            expected_proficiencies[topic_name] = (solved / attempted) * 100
        
        # Calculate proficiency
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        # Verify each topic has correct proficiency
        for topic_name, expected in expected_proficiencies.items():
            assert topic_name in result, f"Topic {topic_name} not found in result"
            assert abs(result[topic_name] - expected) < 0.01, \
                f"Topic {topic_name}: expected {expected}, got {result[topic_name]}"
    
    @given(
        topics_proficiency=st.dictionaries(
            keys=st.text(min_size=1, max_size=30, alphabet=st.characters(whitelist_categories=('Ll', 'Lu', 'Nd'), whitelist_characters='-_')),
            values=st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False),
            min_size=1,
            max_size=20
        )
    )
    @settings(max_examples=100)
    def test_property_7_classification_consistency(self, topics_proficiency):
        """
        **Property 7: Topic classification rules (consistency)**
        **Validates: Requirements 2.3, 2.4**
        
        Test that classification is consistent across multiple topics.
        All topics should be classified according to the same thresholds.
        """
        # Classify topics
        result = classify_topics(topics_proficiency)
        
        # Verify all topics are classified
        assert len(result) == len(topics_proficiency)
        
        # Verify each topic is classified correctly
        for topic_name, proficiency in topics_proficiency.items():
            assert topic_name in result
            classification = result[topic_name]['classification']
            
            # Verify classification matches threshold rules
            if proficiency < 40:
                assert classification == 'weak'
            elif proficiency > 70:
                assert classification == 'strong'
            else:
                assert classification == 'moderate'
    
    @given(
        solved=st.integers(min_value=0, max_value=1000),
        attempted=st.integers(min_value=1, max_value=1000)
    )
    @settings(max_examples=100)
    def test_property_6_proficiency_bounds(self, solved, attempted):
        """
        **Property 6: Topic proficiency calculation (bounds)**
        **Validates: Requirements 2.2**
        
        Test that proficiency is always within valid bounds [0, 100].
        """
        assume(solved <= attempted)
        
        # Create submissions
        submissions = []
        for i in range(solved):
            submissions.append({'topics': ['test-topic'], 'status': 'Accepted'})
        for i in range(attempted - solved):
            submissions.append({'topics': ['test-topic'], 'status': 'Wrong Answer'})
        
        # Calculate proficiency
        result = calculate_topic_proficiency_from_submissions(submissions)
        
        # Verify bounds
        assert 'test-topic' in result
        assert 0 <= result['test-topic'] <= 100, \
            f"Proficiency {result['test-topic']} is out of bounds [0, 100]"
    
    @given(
        proficiency=st.floats(min_value=0.0, max_value=100.0, allow_nan=False, allow_infinity=False)
    )
    @settings(max_examples=100)
    def test_property_7_boundary_values(self, proficiency):
        """
        **Property 7: Topic classification rules (boundary values)**
        **Validates: Requirements 2.3, 2.4**
        
        Test classification at and around boundary values (40% and 70%).
        """
        topic_proficiency = {'test-topic': proficiency}
        result = classify_topics(topic_proficiency)
        
        classification = result['test-topic']['classification']
        
        # Test boundary conditions
        if proficiency < 40:
            assert classification == 'weak'
        elif proficiency == 40.0:
            # At exactly 40%, should be moderate (40 <= x <= 70)
            assert classification == 'moderate'
        elif proficiency < 70:
            assert classification == 'moderate'
        elif proficiency == 70.0:
            # At exactly 70%, should be moderate (40 <= x <= 70)
            assert classification == 'moderate'
        else:  # proficiency > 70
            assert classification == 'strong'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
