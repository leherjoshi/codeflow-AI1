---
title: Debugging Time Limit Exceeded (TLE)
category: debugging
complexity: medium
topics: [optimization, complexity, performance]
---

# Debugging Time Limit Exceeded (TLE)

## What is TLE?

Time Limit Exceeded means your solution takes too long to execute. Online judges typically allow 1-2 seconds for most problems.

## Common Causes

### 1. Wrong Time Complexity

Your algorithm is too slow for the input size.

**Rule of Thumb**:
- n ≤ 10: O(n!) is acceptable
- n ≤ 20: O(2ⁿ) is acceptable
- n ≤ 500: O(n³) is acceptable
- n ≤ 5,000: O(n²) is acceptable
- n ≤ 100,000: O(n log n) is acceptable
- n ≤ 1,000,000: O(n) is acceptable

### 2. Unnecessary Nested Loops

```python
# Bad: O(n³)
for i in range(n):
    for j in range(n):
        for k in range(n):
            # process

# Better: O(n²) or O(n log n)
# Use hash map, sorting, or two pointers
```

### 3. Repeated Calculations

```python
# Bad: Recalculating same values
def fib(n):
    if n <= 1:
        return n
    return fib(n-1) + fib(n-2)  # Exponential time!

# Good: Memoization
memo = {}
def fib(n):
    if n in memo:
        return memo[n]
    if n <= 1:
        return n
    memo[n] = fib(n-1) + fib(n-2)
    return memo[n]
```

### 4. Inefficient Data Structures

- Using list when set/dict is better for lookups
- Using array when heap is better for min/max
- Not using appropriate data structure for the problem

### 5. String Concatenation in Loops

```python
# Bad: O(n²) due to string immutability
result = ""
for char in string:
    result += char  # Creates new string each time

# Good: O(n)
result = []
for char in string:
    result.append(char)
return ''.join(result)
```

## Debugging Steps

### Step 1: Analyze Time Complexity

1. Count nested loops
2. Identify recursive calls
3. Calculate overall complexity
4. Compare with input constraints

### Step 2: Identify Bottlenecks

1. Which part of code runs most frequently?
2. Are there redundant calculations?
3. Can you cache results?
4. Can you use better data structure?

### Step 3: Optimize

**Common Optimizations**:

1. **Use Hash Maps**: O(1) lookup vs O(n) search
2. **Sort First**: Enable binary search or two pointers
3. **Dynamic Programming**: Cache subproblem results
4. **Greedy Approach**: Make locally optimal choices
5. **Binary Search**: Reduce O(n) to O(log n)
6. **Two Pointers**: Reduce O(n²) to O(n)
7. **Sliding Window**: Reduce O(n²) to O(n)

### Step 4: Test with Large Input

Create test case with maximum constraints to verify optimization works.

## Common Patterns to Avoid TLE

### Pattern 1: Replace Nested Loops with Hash Map

```python
# Before: O(n²)
for i in range(n):
    for j in range(i+1, n):
        if arr[i] + arr[j] == target:
            return [i, j]

# After: O(n)
seen = {}
for i, num in enumerate(arr):
    complement = target - num
    if complement in seen:
        return [seen[complement], i]
    seen[num] = i
```

### Pattern 2: Use Sorting + Two Pointers

```python
# Before: O(n³) with three nested loops
# After: O(n² log n) with sorting + two pointers
arr.sort()
for i in range(n):
    left, right = i+1, n-1
    while left < right:
        # two pointer logic
```

### Pattern 3: Memoization for Recursion

```python
# Add @lru_cache decorator
from functools import lru_cache

@lru_cache(maxsize=None)
def recursive_function(n):
    # recursive logic
```

## Quick Fixes

1. **Remove print statements** in loops (I/O is slow)
2. **Use local variables** instead of global lookups
3. **Avoid repeated function calls** in conditions
4. **Use built-in functions** (they're optimized in C)
5. **Consider iterative** instead of recursive

## When to Give Up and Rethink

If optimizations don't work, you might need a completely different algorithm:
- Brute force → Dynamic Programming
- DFS → BFS or vice versa
- Simulation → Mathematical formula
- Iteration → Binary Search

## Prevention Tips

1. **Analyze constraints first** before coding
2. **Calculate expected time complexity**
3. **Choose algorithm based on constraints**
4. **Test with large inputs locally**
5. **Profile code** to find bottlenecks
