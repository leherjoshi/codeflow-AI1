---
title: Debugging Wrong Answer
category: debugging
complexity: easy
topics: [debugging, edge-cases, testing]
---

# Debugging Wrong Answer

## Common Causes of Wrong Answer

### 1. Edge Cases Not Handled

**Common Edge Cases**:
- Empty input (empty array, empty string)
- Single element
- All elements same
- Negative numbers
- Zero
- Very large numbers (overflow)
- Duplicates
- Already sorted/reversed

**Example**:
```python
# Bug: Doesn't handle empty array
def find_max(arr):
    max_val = arr[0]  # IndexError if arr is empty!
    for num in arr:
        if num > max_val:
            max_val = num
    return max_val

# Fix: Handle empty case
def find_max(arr):
    if not arr:
        return None  # or raise exception
    max_val = arr[0]
    for num in arr:
        if num > max_val:
            max_val = num
    return max_val
```

### 2. Off-by-One Errors

**Common Mistakes**:
- Using `<` instead of `<=`
- Wrong loop range
- Array index errors
- Boundary conditions

**Example**:
```python
# Bug: Misses last element
for i in range(len(arr) - 1):  # Should be range(len(arr))
    process(arr[i])

# Bug: Wrong boundary
if left < right:  # Should be left <= right for some problems
    # process
```

### 3. Integer Overflow

**Languages Affected**: C++, Java (not Python)

```cpp
// Bug: Overflow with large numbers
int sum = a + b;  // May overflow

// Fix: Use long long
long long sum = (long long)a + b;
```

### 4. Wrong Data Type

```python
# Bug: Integer division when float needed
average = sum / count  # In Python 2, this is integer division

# Fix: Use float division
average = sum / float(count)  # Or sum / count in Python 3
```

### 5. Incorrect Logic

- Wrong comparison operator
- Wrong boolean logic (AND vs OR)
- Incorrect formula or algorithm
- Misunderstanding problem requirements

### 6. Not Reading Problem Carefully

- Missed constraints
- Misunderstood output format
- Wrong interpretation of problem
- Missed special conditions

## Debugging Strategy

### Step 1: Read Problem Again

1. Highlight key requirements
2. Note all constraints
3. Understand input/output format
4. Check for special cases mentioned

### Step 2: Test with Examples

```python
# Create test cases
test_cases = [
    # (input, expected_output)
    ([1, 2, 3], 6),
    ([], 0),  # Empty
    ([5], 5),  # Single element
    ([-1, -2, -3], -6),  # Negative
    ([0, 0, 0], 0),  # All zeros
]

for input_data, expected in test_cases:
    result = your_function(input_data)
    if result != expected:
        print(f"Failed: {input_data}")
        print(f"Expected: {expected}, Got: {result}")
```

### Step 3: Add Debug Prints

```python
def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    
    while left <= right:
        mid = (left + right) // 2
        print(f"left={left}, right={right}, mid={mid}, arr[mid]={arr[mid]}")
        
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    
    return -1
```

### Step 4: Check Boundary Conditions

Test with:
- Minimum input size
- Maximum input size
- Minimum values
- Maximum values
- Boundary values (0, -1, n-1, n)

### Step 5: Trace Through Example

Walk through code line by line with a failing test case:
1. Write down variable values at each step
2. Check if they match expectations
3. Identify where logic diverges

## Common Fixes

### Fix 1: Handle Empty Input

```python
if not arr:
    return default_value
```

### Fix 2: Check Array Bounds

```python
if 0 <= index < len(arr):
    # safe to access arr[index]
```

### Fix 3: Use Correct Comparison

```python
# For inclusive range
if left <= right:  # Not left < right

# For exclusive range
if left < right:
```

### Fix 4: Initialize Correctly

```python
# For finding minimum
min_val = float('inf')  # Not 0

# For finding maximum
max_val = float('-inf')  # Not 0
```

### Fix 5: Handle Duplicates

```python
# If problem requires unique elements
seen = set()
for num in arr:
    if num not in seen:
        # process
        seen.add(num)
```

## Prevention Checklist

Before submitting:

- [ ] Tested with empty input
- [ ] Tested with single element
- [ ] Tested with all same elements
- [ ] Tested with negative numbers
- [ ] Tested with zero
- [ ] Tested with maximum constraints
- [ ] Checked for integer overflow
- [ ] Verified output format matches requirements
- [ ] Handled all edge cases mentioned in problem
- [ ] Reviewed boundary conditions in loops

## When Stuck

1. **Simplify**: Test with smallest possible input
2. **Compare**: Check against brute force solution
3. **Visualize**: Draw out the algorithm step by step
4. **Take a break**: Fresh eyes catch bugs faster
5. **Ask for help**: Explain problem to someone else (rubber duck debugging)
