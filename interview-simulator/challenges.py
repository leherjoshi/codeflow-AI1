"""
Challenge database for AI Interview Simulator

Contains coding challenges for different interview types
"""

from typing import List, Dict, Any

# FAANG Challenges - Medium/Hard algorithmic focus
FAANG_CHALLENGES = [
    {
        "problem_id": "faang_1",
        "title": "Longest Substring Without Repeating Characters",
        "difficulty": "medium",
        "description": "Given a string s, find the length of the longest substring without repeating characters.",
        "examples": [
            {"input": "s = 'abcabcbb'", "output": "3", "explanation": "The answer is 'abc', with length 3"},
            {"input": "s = 'bbbbb'", "output": "1", "explanation": "The answer is 'b', with length 1"}
        ],
        "constraints": [
            "0 <= s.length <= 5 * 10^4",
            "s consists of English letters, digits, symbols and spaces"
        ],
        "hints": [
            "Use a sliding window approach with a hash set",
            "Track the start of the current window",
            "When you find a duplicate, move the start pointer"
        ],
        "test_cases": [
            {"input": "abcabcbb", "expected": 3},
            {"input": "bbbbb", "expected": 1},
            {"input": "pwwkew", "expected": 3}
        ],
        "follow_up_questions": [
            "What is the time and space complexity of your solution?",
            "How would you optimize for space if the character set is very large?",
            "Can you solve this with O(1) space if the character set is limited?"
        ]
    },
    {
        "problem_id": "faang_2",
        "title": "Merge K Sorted Lists",
        "difficulty": "hard",
        "description": "You are given an array of k linked-lists lists, each linked-list is sorted in ascending order. Merge all the linked-lists into one sorted linked-list and return it.",
        "examples": [
            {"input": "lists = [[1,4,5],[1,3,4],[2,6]]", "output": "[1,1,2,3,4,4,5,6]"},
            {"input": "lists = []", "output": "[]"}
        ],
        "constraints": [
            "k == lists.length",
            "0 <= k <= 10^4",
            "0 <= lists[i].length <= 500"
        ],
        "hints": [
            "Consider using a min heap to efficiently get the smallest element",
            "Think about the time complexity of comparing all k lists",
            "Can you use divide and conquer?"
        ],
        "test_cases": [
            {"input": "[[1,4,5],[1,3,4],[2,6]]", "expected": "[1,1,2,3,4,4,5,6]"},
            {"input": "[]", "expected": "[]"}
        ],
        "follow_up_questions": [
            "What is the time complexity of your solution?",
            "How does your solution scale with k?",
            "Could you use a divide-and-conquer approach instead?"
        ]
    },
    {
        "problem_id": "faang_3",
        "title": "LRU Cache",
        "difficulty": "medium",
        "description": "Design a data structure that follows the constraints of a Least Recently Used (LRU) cache. Implement get(key) and put(key, value) methods.",
        "examples": [
            {"input": "LRUCache(2); put(1,1); put(2,2); get(1); put(3,3); get(2)", "output": "1, -1"}
        ],
        "constraints": [
            "1 <= capacity <= 3000",
            "0 <= key <= 10^4",
            "At most 2 * 10^5 calls will be made to get and put"
        ],
        "hints": [
            "Use a combination of hash map and doubly linked list",
            "The hash map provides O(1) access",
            "The linked list maintains the order of usage"
        ],
        "test_cases": [
            {"input": "capacity=2, ops=['put(1,1)','put(2,2)','get(1)']", "expected": "[null,null,1]"}
        ],
        "follow_up_questions": [
            "What data structures did you use and why?",
            "How do you ensure O(1) time complexity for both operations?",
            "How would you handle thread safety?"
        ]
    }
]

# Startup Challenges - Practical, real-world focus
STARTUP_CHALLENGES = [
    {
        "problem_id": "startup_1",
        "title": "Rate Limiter Design",
        "difficulty": "medium",
        "description": "Design a rate limiter that allows a maximum of N requests per time window. Implement allow_request(user_id) that returns True if the request is allowed.",
        "examples": [
            {"input": "limit=3, window=60s, requests at t=0,1,2,3", "output": "True,True,True,False"}
        ],
        "constraints": [
            "1 <= N <= 1000",
            "Time window is in seconds",
            "Must handle concurrent requests"
        ],
        "hints": [
            "Consider using a sliding window approach",
            "Think about how to efficiently clean up old requests",
            "What data structure would give you O(1) lookups?"
        ],
        "test_cases": [
            {"input": "limit=3, window=60, requests=[0,1,2,3]", "expected": "[True,True,True,False]"}
        ],
        "follow_up_questions": [
            "How would you scale this to millions of users?",
            "What happens if the server restarts?",
            "How would you implement this in a distributed system?"
        ]
    },
    {
        "problem_id": "startup_2",
        "title": "URL Shortener",
        "difficulty": "medium",
        "description": "Design a URL shortening service like bit.ly. Implement encode(long_url) and decode(short_url) methods.",
        "examples": [
            {"input": "encode('https://example.com/very/long/url')", "output": "'abc123'"},
            {"input": "decode('abc123')", "output": "'https://example.com/very/long/url'"}
        ],
        "constraints": [
            "URLs can be up to 2048 characters",
            "Short URLs should be 6-8 characters",
            "Must handle collisions"
        ],
        "hints": [
            "Consider using base62 encoding",
            "Think about how to generate unique IDs",
            "What database would you use?"
        ],
        "test_cases": [
            {"input": "encode('https://example.com')", "expected": "6-8 char string"}
        ],
        "follow_up_questions": [
            "How do you ensure uniqueness of short URLs?",
            "How would you handle custom short URLs?",
            "What's your strategy for scaling to billions of URLs?"
        ]
    },
    {
        "problem_id": "startup_3",
        "title": "Event Logger with Search",
        "difficulty": "medium",
        "description": "Design a system that logs events with timestamps and allows searching events within a time range. Implement log(timestamp, event) and search(start, end).",
        "examples": [
            {"input": "log(1,'login'); log(2,'click'); search(1,2)", "output": "['login','click']"}
        ],
        "constraints": [
            "Events arrive in chronological order",
            "Timestamps are Unix timestamps",
            "Search should be efficient"
        ],
        "hints": [
            "Consider using a data structure that maintains sorted order",
            "Binary search could be useful for range queries",
            "Think about memory vs query speed tradeoffs"
        ],
        "test_cases": [
            {"input": "log(1,'a'); log(2,'b'); search(1,2)", "expected": "['a','b']"}
        ],
        "follow_up_questions": [
            "How would you optimize for write-heavy workloads?",
            "What if events don't arrive in order?",
            "How would you implement this in a distributed system?"
        ]
    }
]

# General Challenges - Balanced difficulty, foundational concepts
GENERAL_CHALLENGES = [
    {
        "problem_id": "general_1",
        "title": "Two Sum",
        "difficulty": "easy",
        "description": "Given an array of integers nums and an integer target, return indices of the two numbers that add up to target.",
        "examples": [
            {"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]"},
            {"input": "nums = [3,2,4], target = 6", "output": "[1,2]"}
        ],
        "constraints": [
            "2 <= nums.length <= 10^4",
            "Only one valid answer exists"
        ],
        "hints": [
            "Think about using a hash map",
            "You can solve this in one pass",
            "What complement do you need for each number?"
        ],
        "test_cases": [
            {"input": "[2,7,11,15], 9", "expected": "[0,1]"},
            {"input": "[3,2,4], 6", "expected": "[1,2]"}
        ],
        "follow_up_questions": [
            "What is the time and space complexity?",
            "Can you solve it with O(1) space?",
            "How would you handle duplicate values?"
        ]
    },
    {
        "problem_id": "general_2",
        "title": "Valid Parentheses",
        "difficulty": "easy",
        "description": "Given a string containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.",
        "examples": [
            {"input": "s = '()'", "output": "true"},
            {"input": "s = '()[]{}'", "output": "true"},
            {"input": "s = '(]'", "output": "false"}
        ],
        "constraints": [
            "1 <= s.length <= 10^4",
            "s consists of parentheses only"
        ],
        "hints": [
            "Use a stack data structure",
            "Push opening brackets, pop for closing brackets",
            "Check if the popped bracket matches"
        ],
        "test_cases": [
            {"input": "()", "expected": True},
            {"input": "()[]{}", "expected": True},
            {"input": "(]", "expected": False}
        ],
        "follow_up_questions": [
            "What is the time complexity?",
            "How would you handle nested parentheses?",
            "Can you solve this without a stack?"
        ]
    },
    {
        "problem_id": "general_3",
        "title": "Binary Tree Level Order Traversal",
        "difficulty": "medium",
        "description": "Given the root of a binary tree, return the level order traversal of its nodes' values (i.e., from left to right, level by level).",
        "examples": [
            {"input": "root = [3,9,20,null,null,15,7]", "output": "[[3],[9,20],[15,7]]"}
        ],
        "constraints": [
            "The number of nodes in the tree is in the range [0, 2000]"
        ],
        "hints": [
            "Use a queue for breadth-first search",
            "Process nodes level by level",
            "Track the size of each level"
        ],
        "test_cases": [
            {"input": "[3,9,20,null,null,15,7]", "expected": "[[3],[9,20],[15,7]]"}
        ],
        "follow_up_questions": [
            "What is the space complexity?",
            "How would you do this recursively?",
            "Can you traverse right to left instead?"
        ]
    }
]

# All challenges combined
ALL_CHALLENGES = {
    "faang": FAANG_CHALLENGES,
    "startup": STARTUP_CHALLENGES,
    "general": GENERAL_CHALLENGES
}
