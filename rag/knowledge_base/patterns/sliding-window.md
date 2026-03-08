---
title: Sliding Window Pattern
category: patterns
complexity: easy
topics: [arrays, strings, two-pointers, optimization]
---

# Sliding Window Pattern

## Overview

The sliding window pattern is used to perform operations on a specific window size of an array or string. The window "slides" through the data structure to examine different subsets.

## When to Use

- Problem involves arrays or strings
- Need to find subarrays/substrings that satisfy certain conditions
- Looking for longest, shortest, or optimal contiguous sequence
- Keywords: "contiguous", "subarray", "substring", "window"

## Types of Sliding Windows

### 1. Fixed-Size Window

Window size is constant throughout.

**Example**: Maximum sum of k consecutive elements

```
Array: [1, 3, 2, 6, -1, 4, 1, 8, 2], k=3
Window slides: [1,3,2] → [3,2,6] → [2,6,-1] → ...
```

**Pattern**:
1. Calculate sum of first k elements
2. Slide window: subtract left element, add right element
3. Track maximum/minimum

### 2. Variable-Size Window

Window size changes based on conditions.

**Example**: Longest substring with at most k distinct characters

**Pattern**:
1. Expand window by moving right pointer
2. When condition violated, shrink from left
3. Track optimal window size

## Common Problems

### Fixed Window
- Maximum sum subarray of size k
- Average of subarrays of size k
- First negative in every window of size k

### Variable Window
- Longest substring without repeating characters
- Minimum window substring
- Longest substring with k distinct characters
- Maximum consecutive ones

## Time Complexity

- Usually O(n) - each element visited at most twice
- Much better than brute force O(n²) or O(n³)

## Implementation Tips

1. Use two pointers (left and right)
2. Expand window by moving right pointer
3. Shrink window by moving left pointer when needed
4. Track window state (sum, count, frequency map)
5. Update result at appropriate times

## Common Mistakes

- Forgetting to update window state when shrinking
- Not handling edge cases (empty array, k > array length)
- Updating result at wrong time
- Off-by-one errors with window boundaries

## Template

```
left = 0
window_state = initialize()
result = initialize()

for right in range(len(array)):
    # Expand window
    add array[right] to window_state
    
    # Shrink window if needed
    while window_invalid():
        remove array[left] from window_state
        left += 1
    
    # Update result
    result = update(result, window_state)

return result
```
