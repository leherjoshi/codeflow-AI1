---
title: Two Pointers Pattern
category: patterns
complexity: easy
topics: [arrays, strings, sorting, optimization]
---

# Two Pointers Pattern

## Overview

The two pointers pattern uses two pointers to iterate through a data structure, often from different ends or at different speeds, to solve problems efficiently.

## When to Use

- Dealing with sorted arrays or linked lists
- Need to find pairs or triplets with specific properties
- Searching for a target in sorted data
- Removing duplicates or elements in-place
- Keywords: "sorted", "pairs", "triplets", "in-place"

## Types of Two Pointers

### 1. Opposite Direction (Converging)

Pointers start at opposite ends and move toward each other.

**Use Cases**:
- Two sum in sorted array
- Container with most water
- Valid palindrome
- Trapping rain water

**Pattern**:
```
left = 0
right = len(array) - 1

while left < right:
    if condition_met:
        process and return
    elif need_larger_value:
        left += 1
    else:
        right -= 1
```

### 2. Same Direction (Fast and Slow)

Both pointers move in same direction at different speeds.

**Use Cases**:
- Remove duplicates from sorted array
- Move zeros to end
- Linked list cycle detection
- Finding middle of linked list

**Pattern**:
```
slow = 0
for fast in range(len(array)):
    if condition:
        array[slow] = array[fast]
        slow += 1
```

### 3. Sliding Window (Special Case)

Two pointers define a window that slides through data.

**Use Cases**:
- Longest substring problems
- Subarray sum problems
- See Sliding Window pattern for details

## Common Problems

### Opposite Direction
- Two Sum II (sorted array)
- Three Sum
- Four Sum
- Container With Most Water
- Valid Palindrome

### Same Direction
- Remove Duplicates from Sorted Array
- Remove Element
- Move Zeroes
- Linked List Cycle
- Happy Number

## Time Complexity

- Usually O(n) - single pass through data
- Much better than nested loops O(n²)
- Space: O(1) - in-place operations

## Key Insights

1. **Sorted Data**: Two pointers work best with sorted data
2. **In-Place**: Often modifies array in-place to save space
3. **Greedy Decisions**: Make locally optimal choices at each step
4. **Pointer Movement**: Decide which pointer to move based on comparison

## Common Mistakes

- Not handling edge cases (empty array, single element)
- Moving wrong pointer
- Off-by-one errors with boundaries
- Forgetting to check left < right condition
- Not considering duplicates

## Tips

1. Draw out examples to visualize pointer movement
2. Consider what happens when pointers meet
3. Think about when to move which pointer
4. Handle duplicates explicitly if needed
5. Test with edge cases: empty, single element, all same
