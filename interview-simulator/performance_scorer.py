"""
Performance Scoring Module

Calculates performance scores based on coding, quality, communication, and behavioral assessments
"""

from typing import Dict, Any, List

from models import PerformanceScore, InterviewType


# Scoring weights
SCORING_WEIGHTS = {
    "coding_correctness": 0.40,  # 40%
    "code_quality": 0.20,        # 20%
    "communication": 0.20,        # 20%
    "behavioral": 0.20           # 20%
}

# FAANG multipliers for algorithmic optimization
FAANG_MULTIPLIERS = {
    "algorithmic_optimization": 1.15,  # 15% bonus for optimal solutions
    "system_thinking": 1.10            # 10% bonus for system design thinking
}


class PerformanceScorer:
    """Calculates performance scores for interview sessions"""
    
    def __init__(self, interview_type: InterviewType):
        """
        Initialize Performance Scorer
        
        Args:
            interview_type: Type of interview (FAANG, startup, general)
        """
        self.interview_type = interview_type
        self.weights = SCORING_WEIGHTS.copy()
    def calculate_coding_score(self, evaluations: List[Dict[str, Any]]) -> float:
        """
        Calculate coding correctness score
        
        Args:
            evaluations: List of code evaluation results
            
        Returns:
            Score 0-100
        """
        if not evaluations:
            return 0.0
        
        total_score = 0.0
        for eval_data in evaluations:
            # Extract overall score from evaluation
            score = eval_data.get('overall_score', 50)
            total_score += score
        
        return total_score / len(evaluations)
    def calculate_quality_score(self, evaluations: List[Dict[str, Any]]) -> float:
        """
        Calculate code quality score (readability, structure, best practices)
        
        Args:
            evaluations: List of code evaluation results
            
        Returns:
            Score 0-100
        """
        if not evaluations:
            return 0.0
        
        total_score = 0.0
        for eval_data in evaluations:
            # Parse quality indicators from evaluation
            quality_text = eval_data.get('code_quality', '').lower()
            
            # Simple scoring based on keywords
            score = 50  # Base score
            if 'excellent' in quality_text or 'great' in quality_text:
                score = 90
            elif 'good' in quality_text or 'well' in quality_text:
                score = 75
            elif 'adequate' in quality_text or 'acceptable' in quality_text:
                score = 60
            elif 'poor' in quality_text or 'needs improvement' in quality_text:
                score = 40
            
            total_score += score
        
        return total_score / len(evaluations)
    def calculate_communication_score(
        self,
        evaluations: List[Dict[str, Any]],
        behavioral_assessments: List[Dict[str, Any]]
    ) -> float:
        """
        Calculate communication score (clarity, structure, completeness)
        
        Args:
            evaluations: Code evaluations (for technical communication)
            behavioral_assessments: Behavioral response assessments
            
        Returns:
            Score 0-100
        """
        scores = []
        
        # Score from code evaluations (technical communication)
        for eval_data in evaluations:
            feedback = eval_data.get('feedback', '').lower()
            if 'clear' in feedback or 'well-explained' in feedback:
                scores.append(80)
            elif 'unclear' in feedback or 'confusing' in feedback:
                scores.append(40)
            else:
                scores.append(60)
        
        # Score from behavioral assessments
        for assessment in behavioral_assessments:
            clarity_score = assessment.get('clarity_score', 50)
            scores.append(clarity_score)
        
        return sum(scores) / len(scores) if scores else 50.0
    def calculate_behavioral_score(self, behavioral_assessments: List[Dict[str, Any]]) -> float:
        """
        Calculate behavioral score (STAR method adherence)
        
        Args:
            behavioral_assessments: List of behavioral response assessments
            
        Returns:
            Score 0-100
        """
        if not behavioral_assessments:
            return 0.0
        
        total_score = 0.0
        for assessment in behavioral_assessments:
            # Average STAR components
            situation = assessment.get('situation_score', 50)
            task = assessment.get('task_score', 50)
            action = assessment.get('action_score', 50)
            result = assessment.get('result_score', 50)
            
            star_score = (situation + task + action + result) / 4
            total_score += star_score
        
        return total_score / len(behavioral_assessments)
    def apply_interview_type_adjustments(
        self,
        scores: Dict[str, float],
        evaluations: List[Dict[str, Any]]
    ) -> Dict[str, float]:
        """
        Apply interview type-specific adjustments
        
        Args:
            scores: Dictionary of component scores
            evaluations: Code evaluations for optimization analysis
            
        Returns:
            Adjusted scores dictionary
        """
        adjusted_scores = scores.copy()
        
        # FAANG: Apply stricter criteria and bonuses for optimization
        if self.interview_type == InterviewType.FAANG:
            # Check for algorithmic optimization
            has_optimal_solution = False
            for eval_data in evaluations:
                complexity = eval_data.get('time_complexity', '').lower()
                if 'optimal' in complexity or 'o(n)' in complexity or 'o(log n)' in complexity:
                    has_optimal_solution = True
                    break
            
            if has_optimal_solution:
                adjusted_scores['coding_correctness'] *= FAANG_MULTIPLIERS['algorithmic_optimization']
                adjusted_scores['coding_correctness'] = min(100, adjusted_scores['coding_correctness'])
        
        return adjusted_scores
    def calculate_overall_score(
        self,
        evaluations: List[Dict[str, Any]],
        behavioral_assessments: List[Dict[str, Any]]
    ) -> PerformanceScore:
        """
        Calculate overall performance score
        
        Args:
            evaluations: List of code evaluations
            behavioral_assessments: List of behavioral assessments
            
        Returns:
            PerformanceScore instance
        """
        # Calculate component scores
        coding_score = self.calculate_coding_score(evaluations)
        quality_score = self.calculate_quality_score(evaluations)
        communication_score = self.calculate_communication_score(evaluations, behavioral_assessments)
        behavioral_score = self.calculate_behavioral_score(behavioral_assessments)
        
        # Apply interview type adjustments
        scores = {
            'coding_correctness': coding_score,
            'code_quality': quality_score,
            'communication': communication_score,
            'behavioral': behavioral_score
        }
        adjusted_scores = self.apply_interview_type_adjustments(scores, evaluations)
        
        # Calculate weighted overall score
        overall = (
            adjusted_scores['coding_correctness'] * self.weights['coding_correctness'] +
            adjusted_scores['code_quality'] * self.weights['code_quality'] +
            adjusted_scores['communication'] * self.weights['communication'] +
            adjusted_scores['behavioral'] * self.weights['behavioral']
        )
        
        # Create PerformanceScore instance
        return PerformanceScore(
            overall_score=round(overall, 2),
            coding_correctness=round(adjusted_scores['coding_correctness'], 2),
            code_quality=round(adjusted_scores['code_quality'], 2),
            communication=round(adjusted_scores['communication'], 2),
            behavioral=round(adjusted_scores['behavioral'], 2)
        )
    def get_historical_comparison(
        self,
        current_score: float,
        historical_scores: List[float]
    ) -> Dict[str, Any]:
        """
        Compare current score with historical performance
        
        Args:
            current_score: Current interview score
            historical_scores: List of previous interview scores
            
        Returns:
            Comparison dictionary with trend analysis
        """
        if not historical_scores:
            return {
                'trend': 'no_history',
                'average_historical': 0,
                'improvement': 0,
                'message': 'This is your first interview!'
            }
        
        avg_historical = sum(historical_scores) / len(historical_scores)
        improvement = current_score - avg_historical
        
        # Determine trend
        if improvement > 10:
            trend = 'significant_improvement'
            message = f'Great progress! You scored {improvement:.1f} points higher than your average.'
        elif improvement > 0:
            trend = 'improvement'
            message = f'Nice work! You improved by {improvement:.1f} points.'
        elif improvement > -10:
            trend = 'stable'
            message = f'Consistent performance, similar to your average.'
        else:
            trend = 'decline'
            message = f'Your score was {abs(improvement):.1f} points lower than average. Review the feedback for areas to focus on.'
        
        return {
            'trend': trend,
            'average_historical': round(avg_historical, 2),
            'improvement': round(improvement, 2),
            'message': message
        }
