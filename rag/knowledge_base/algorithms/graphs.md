---
title: Graph Algorithms Essentials
category: algorithms
complexity: medium
topics: [graphs, bfs, dfs, shortest-path]
---

# Graph Algorithms Essentials

## Graph Basics

A graph is a data structure consisting of nodes (vertices) and edges connecting them.

### Types of Graphs

1. **Directed vs Undirected**: Edges have direction or not
2. **Weighted vs Unweighted**: Edges have weights or not
3. **Cyclic vs Acyclic**: Contains cycles or not
4. **Connected vs Disconnected**: All nodes reachable or not

## Core Traversal Algorithms

### Breadth-First Search (BFS)

- Explores level by level
- Uses a queue
- Finds shortest path in unweighted graphs
- Time: O(V + E), Space: O(V)

**Use Cases**:
- Shortest path in unweighted graph
- Level-order traversal
- Finding connected components

### Depth-First Search (DFS)

- Explores as deep as possible before backtracking
- Uses recursion or stack
- Time: O(V + E), Space: O(V)

**Use Cases**:
- Cycle detection
- Topological sorting
- Finding strongly connected components
- Path finding

## Shortest Path Algorithms

### Dijkstra's Algorithm
- Finds shortest path from source to all vertices
- Works with non-negative weights
- Time: O((V + E) log V) with priority queue

### Bellman-Ford Algorithm
- Handles negative weights
- Detects negative cycles
- Time: O(V * E)

## Common Graph Problems

- Number of Islands
- Course Schedule (topological sort)
- Clone Graph
- Word Ladder
- Network Delay Time

## Graph Representation

### Adjacency List (Preferred)
```
graph = {
    0: [1, 2],
    1: [2],
    2: [3]
}
```
- Space: O(V + E)
- Better for sparse graphs

### Adjacency Matrix
```
matrix = [
    [0, 1, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
    [0, 0, 0, 0]
]
```
- Space: O(V²)
- Better for dense graphs

## Tips

1. Always clarify if graph is directed or undirected
2. Check for cycles before using DFS
3. Use visited set to avoid infinite loops
4. Consider edge cases: empty graph, single node, disconnected components
