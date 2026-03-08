---
title: Dynamic Programming Fundamentals
category: algorithms
complexity: medium
topics: [dynamic-programming, optimization, memoization]
---

# Dynamic Programming Fundamentals

## What is Dynamic Programming?

Dynamic Programming (DP) is an optimization technique that solves complex problems by breaking them down into simpler subproblems. It stores the results of subproblems to avoid redundant calculations.

## Key Characteristics

1. **Overlapping Subproblems**: The problem can be broken down into subproblems which are reused several times
2. **Optimal Substructure**: An optimal solution can be constructed from optimal solutions of its subproblems

## Common Patterns

### 1. Memoization (Top-Down)
- Start with the original problem
- Recursively break it down
- Cache results to avoid recomputation

### 2. Tabulation (Bottom-Up)
- Start with the smallest subproblems
- Build up to the original problem
- Use an array/table to store results

## When to Use DP

- Problem asks for optimization (maximum, minimum, longest, shortest)
- Problem can be broken into similar subproblems
- Brute force solution has repeated calculations
- Problem involves making choices at each step

## Common DP Problems

- Fibonacci sequence
- Longest Common Subsequence
- 0/1 Knapsack
- Coin Change
- Edit Distance
- Maximum Subarray

## Time Complexity

- Typically reduces exponential time to polynomial time
- Often O(n²) or O(n*m) for 2D problems
- Space can often be optimized to O(n) or O(1)

## Tips for Beginners

1. Start by identifying the recursive structure
2. Define the state (what parameters change)
3. Write the recurrence relation
4. Identify base cases
5. Implement with memoization first
6. Optimize to tabulation if needed
