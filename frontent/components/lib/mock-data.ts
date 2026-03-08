export const mockUserData = {
  username: "coder_pro",
  problemsSolved: 245,
  rating: 1620,
  strongestTopic: "Arrays",
  weakestTopic: "Dynamic Programming",
  streak: 12,
  badges: ["7-day-streak", "100-problems"],
}

export const mockTopicMastery = [
  { topic: "Arrays", value: 80, fullMark: 100 },
  { topic: "Graphs", value: 60, fullMark: 100 },
  { topic: "Dynamic Programming", value: 40, fullMark: 100 },
  { topic: "Trees", value: 70, fullMark: 100 },
  { topic: "Greedy", value: 65, fullMark: 100 },
  { topic: "Backtracking", value: 55, fullMark: 100 },
]

export const mockRoadmap: Array<{
  day: number
  title: string
  description: string
  difficulty: "Easy" | "Medium" | "Hard"
  completed: boolean
}> = [
  {
    day: 1,
    title: "BFS Fundamentals",
    description: "Master breadth-first search traversal patterns",
    difficulty: "Easy",
    completed: true,
  },
  {
    day: 2,
    title: "Shortest Path Algorithms",
    description: "Learn Dijkstra and Bellman-Ford algorithms",
    difficulty: "Medium",
    completed: true,
  },
  {
    day: 3,
    title: "Graph Traversal Practice",
    description: "Solve 5 graph problems using BFS/DFS",
    difficulty: "Medium",
    completed: false,
  },
  {
    day: 4,
    title: "Dijkstra Problems",
    description: "Advanced shortest path problem solving",
    difficulty: "Hard",
    completed: false,
  },
  {
    day: 5,
    title: "Advanced Graph Problems",
    description: "Topological sort and strongly connected components",
    difficulty: "Hard",
    completed: false,
  },
]

export const mockAIInsights = [
  "Your submissions show difficulty with dynamic programming state transitions.",
  "Strong performance in array manipulation and two-pointer techniques.",
  "Consider practicing more graph traversal problems to improve BFS/DFS skills.",
]

export const mockChatHistory: Array<{
  role: "user" | "assistant"
  content: string
  timestamp: string
}> = [
  {
    role: "user",
    content: "I struggle with graph problems.",
    timestamp: "2024-03-07T10:30:00Z",
  },
  {
    role: "assistant",
    content:
      "Your LeetCode submissions suggest difficulty with BFS traversal and adjacency list representations. I recommend starting with these fundamentals:\n\n1. **BFS Template**: Practice the standard queue-based approach\n2. **Adjacency Lists**: Master graph representation\n3. **Level-order Traversal**: Start with tree problems before graphs\n\nWould you like me to suggest specific problems?",
    timestamp: "2024-03-07T10:30:05Z",
  },
]

export const mockInterviewProblem: {
  title: string
  difficulty: "Easy" | "Medium" | "Hard"
  description: string
  examples: Array<{
    input: string
    output: string
    explanation: string
  }>
  constraints: string[]
} = {
  title: "Two Sum",
  difficulty: "Easy",
  description:
    "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
  examples: [
    {
      input: "nums = [2,7,11,15], target = 9",
      output: "[0,1]",
      explanation: "Because nums[0] + nums[1] == 9, we return [0, 1].",
    },
  ],
  constraints: [
    "2 <= nums.length <= 10^4",
    "-10^9 <= nums[i] <= 10^9",
    "-10^9 <= target <= 10^9",
    "Only one valid answer exists.",
  ],
}
