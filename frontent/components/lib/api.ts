// CodeFlow AI - API Client
// Handles all backend API communication

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://n8e9ghd13g.execute-api.ap-south-1.amazonaws.com/dev'
const USE_MOCK_DATA = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true' || false

// Types
export interface User {
  user_id: string
  leetcode_username: string
  language_preference: string
}

export interface AuthResponse {
  access_token: string
  refresh_token: string
  user?: User
  expires_in?: number
}

export interface TopicProficiency {
  proficiency: number
  classification: 'weak' | 'moderate' | 'strong'
}

export interface ProfileAnalysis {
  user_id: string
  topics: Record<string, TopicProficiency>
  heatmap: {
    weak: Array<{ name: string; proficiency: number }>
    moderate: Array<{ name: string; proficiency: number }>
    strong: Array<{ name: string; proficiency: number }>
  }
  summary: {
    total_topics: number
    weak_topics: number
    moderate_topics: number
    strong_topics: number
  }
}

export interface Problem {
  title: string
  difficulty: 'Easy' | 'Medium' | 'Hard'
  topics: string[]
  leetcode_id: string
  estimated_time_minutes: number
  reason?: string
}

export interface LearningPath {
  path_id: string
  problems: Problem[]
  total_problems: number
  weak_topics_targeted: string[]
  created_at: string
}

export interface Badge {
  badge_id: string
  name: string
  earned_at: string
  milestone: number
}

export interface Progress {
  user_id: string
  streak_count: number
  badges: Badge[]
  problems_solved_today: number
  total_problems_solved: number
  last_solve_timestamp: string | null
  next_milestone: {
    days: number
    badge_name: string
    days_remaining: number
  } | null
}

export interface ChatResponse {
  response: string
  intent: 'CODE_DEBUGGING' | 'CONCEPT_QUESTION' | 'HINT_REQUEST' | 'GENERAL'
  cached: boolean
  model_used: 'haiku' | 'sonnet'
}

// API Client Class
class APIClient {
  private baseURL: string
  private accessToken: string | null = null

  constructor(baseURL: string) {
    this.baseURL = baseURL
    // Load token from localStorage if available
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('access_token')
    }
  }

  // Set authentication token
  setToken(token: string) {
    this.accessToken = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', token)
    }
  }

  // Clear authentication token
  clearToken() {
    this.accessToken = null
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('user')
    }
  }

  // Generic request method
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    // Add auth token if available
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      })

      // Handle 403 - authentication failure
      if (response.status === 403) {
        this.clearToken()
        throw new Error('Authentication failed. Please login again.')
      }

      // Handle 401 - try to refresh token
      if (response.status === 401 && this.accessToken) {
        const refreshed = await this.refreshToken()
        if (refreshed) {
          // Retry request with new token
          headers['Authorization'] = `Bearer ${this.accessToken}`
          const retryResponse = await fetch(url, { ...options, headers })
          if (!retryResponse.ok) {
            throw new Error(`API Error: ${retryResponse.statusText}`)
          }
          return retryResponse.json()
        } else {
          this.clearToken()
          throw new Error('Session expired. Please login again.')
        }
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(error.error || `API Error: ${response.statusText}`)
      }

      return response.json()
    } catch (error) {
      console.error('API Request failed:', error)
      throw error
    }
  }

  // Authentication
  async register(
    leetcode_username: string,
    email: string,
    password: string,
    language_preference: string = 'en'
  ): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        leetcode_username,
        email,
        password,
        language_preference,
      }),
    })
    
    this.setToken(response.access_token)
    if (typeof window !== 'undefined') {
      localStorage.setItem('refresh_token', response.refresh_token)
      if (response.user) {
        localStorage.setItem('user', JSON.stringify(response.user))
      }
    }
    
    return response
  }

  async login(leetcode_username: string, password: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ leetcode_username, password }),
    })
    
    this.setToken(response.access_token)
    if (typeof window !== 'undefined') {
      localStorage.setItem('refresh_token', response.refresh_token)
      if (response.user) {
        localStorage.setItem('user', JSON.stringify(response.user))
      }
    }
    
    return response
  }

  async refreshToken(): Promise<boolean> {
    try {
      if (typeof window === 'undefined') return false
      
      const refreshToken = localStorage.getItem('refresh_token')
      if (!refreshToken) return false

      const response = await this.request<{ access_token: string; expires_in: number }>(
        '/auth/refresh',
        {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken }),
        }
      )

      this.setToken(response.access_token)
      return true
    } catch (error) {
      console.error('Token refresh failed:', error)
      return false
    }
  }

  // Scraping
  async fetchProfile(
    user_id: string,
    leetcode_username: string
  ): Promise<{ message: string; user_id: string; leetcode_username: string; profile: any }> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 500))
      return {
        message: 'Profile fetched successfully (MOCK)',
        user_id,
        leetcode_username,
        profile: {
          username: leetcode_username,
          total_solved: 150,
          easy_solved: 80,
          medium_solved: 50,
          hard_solved: 20,
          topics: [
            { name: 'Arrays', slug: 'arrays', problems_solved: 25, level: 'fundamental' },
            { name: 'Strings', slug: 'strings', problems_solved: 20, level: 'fundamental' },
            { name: 'Hash Tables', slug: 'hash-tables', problems_solved: 18, level: 'intermediate' },
            { name: 'Trees', slug: 'trees', problems_solved: 12, level: 'intermediate' },
            { name: 'Graphs', slug: 'graphs', problems_solved: 8, level: 'advanced' },
            { name: 'Dynamic Programming', slug: 'dynamic-programming', problems_solved: 10, level: 'advanced' }
          ]
        }
      }
    }
    return this.request('/scraping/fetch-profile', {
      method: 'POST',
      body: JSON.stringify({ user_id, leetcode_username }),
    })
  }

  // Profile Analysis
  async analyzeProfile(
    user_id: string,
    leetcode_username: string
  ): Promise<ProfileAnalysis> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 500))
      return {
        user_id,
        topics: {
          'arrays': { proficiency: 75, classification: 'strong' },
          'strings': { proficiency: 65, classification: 'moderate' },
          'hash-tables': { proficiency: 80, classification: 'strong' },
          'trees': { proficiency: 45, classification: 'moderate' },
          'graphs': { proficiency: 35, classification: 'weak' },
          'dynamic-programming': { proficiency: 50, classification: 'moderate' }
        },
        heatmap: {
          weak: [{ name: 'graphs', proficiency: 35 }],
          moderate: [
            { name: 'trees', proficiency: 45 },
            { name: 'dynamic-programming', proficiency: 50 },
            { name: 'strings', proficiency: 65 }
          ],
          strong: [
            { name: 'arrays', proficiency: 75 },
            { name: 'hash-tables', proficiency: 80 }
          ]
        },
        summary: {
          total_topics: 6,
          weak_topics: 1,
          moderate_topics: 3,
          strong_topics: 2
        }
      }
    }
    return this.request<ProfileAnalysis>('/analyze/profile', {
      method: 'POST',
      body: JSON.stringify({ user_id, leetcode_username }),
    })
  }

  async getTopics(user_id: string): Promise<{ user_id: string; topics: Record<string, TopicProficiency> }> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 300))
      return {
        user_id,
        topics: {
          'arrays': { proficiency: 0.75, classification: 'strong' },
          'strings': { proficiency: 0.65, classification: 'moderate' },
          'hash-tables': { proficiency: 0.80, classification: 'strong' },
          'trees': { proficiency: 0.45, classification: 'moderate' },
          'graphs': { proficiency: 0.35, classification: 'weak' },
          'dynamic-programming': { proficiency: 0.50, classification: 'moderate' }
        }
      }
    }
    return this.request(`/analyze/${user_id}/topics`)
  }

  // Progress
  async getProgress(user_id: string): Promise<Progress> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 300))
      return {
        user_id,
        streak_count: 7,
        badges: [
          { badge_id: '1', name: 'Week Warrior', earned_at: new Date().toISOString(), milestone: 7 }
        ],
        problems_solved_today: 3,
        total_problems_solved: 150,
        last_solve_timestamp: new Date().toISOString(),
        next_milestone: {
          days: 14,
          badge_name: 'Two Week Champion',
          days_remaining: 7
        }
      }
    }
    return this.request(`/progress/${user_id}`)
  }

  // Chat Mentor
  async chatMentor(
    user_id: string,
    message: string,
    code?: string,
    problem_id?: string
  ): Promise<ChatResponse> {
    return this.request<ChatResponse>('/chat-mentor', {
      method: 'POST',
      body: JSON.stringify({
        user_id,
        message,
        code,
        problem_id,
      }),
    })
  }

  // Recommendations
  async generateLearningPath(
    user_id: string,
    weak_topics?: string[],
    strong_topics?: string[],
    proficiency_level: 'beginner' | 'intermediate' | 'advanced' = 'intermediate'
  ): Promise<LearningPath> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 500))
      return {
        path_id: 'mock-path-123',
        problems: [
          {
            title: 'Two Sum',
            difficulty: 'Easy',
            topics: ['Arrays', 'Hash Table'],
            leetcode_id: '1',
            estimated_time_minutes: 15,
            reason: 'Build foundation in hash tables'
          },
          {
            title: 'Binary Tree Inorder Traversal',
            difficulty: 'Easy',
            topics: ['Trees', 'DFS'],
            leetcode_id: '94',
            estimated_time_minutes: 20,
            reason: 'Strengthen tree traversal skills'
          },
          {
            title: 'Number of Islands',
            difficulty: 'Medium',
            topics: ['Graphs', 'DFS', 'BFS'],
            leetcode_id: '200',
            estimated_time_minutes: 30,
            reason: 'Practice graph algorithms'
          },
          {
            title: 'Climbing Stairs',
            difficulty: 'Easy',
            topics: ['Dynamic Programming'],
            leetcode_id: '70',
            estimated_time_minutes: 15,
            reason: 'Introduction to DP'
          },
          {
            title: 'Coin Change',
            difficulty: 'Medium',
            topics: ['Dynamic Programming'],
            leetcode_id: '322',
            estimated_time_minutes: 25,
            reason: 'Classic DP problem'
          }
        ],
        total_problems: 5,
        weak_topics_targeted: weak_topics || ['graphs', 'dynamic-programming'],
        created_at: new Date().toISOString()
      }
    }
    return this.request<LearningPath>('/recommendations/generate-path', {
      method: 'POST',
      body: JSON.stringify({
        user_id,
        weak_topics,
        strong_topics,
        proficiency_level,
      }),
    })
  }

  async getNextProblem(user_id: string): Promise<{
    problem: Problem
    reason: string
    current_index: number
    total_problems: number
  }> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 300))
      return {
        problem: {
          title: 'Number of Islands',
          difficulty: 'Medium',
          topics: ['Graphs', 'DFS', 'BFS'],
          leetcode_id: '200',
          estimated_time_minutes: 30,
          reason: 'Practice graph algorithms to strengthen weak areas'
        },
        reason: 'This problem targets your weak topic: graphs',
        current_index: 2,
        total_problems: 5
      }
    }
    return this.request(`/recommendations/next-problem?user_id=${user_id}`)
  }

  async generateHint(
    problem_id: string,
    user_id: string,
    problem_description: string,
    hint_level: 1 | 2 | 3 = 1
  ): Promise<{ hint: string; hint_level: number; problem_id: string }> {
    if (USE_MOCK_DATA) {
      await new Promise(resolve => setTimeout(resolve, 800))
      const hints = {
        1: 'Think about how you can explore all connected land cells. What data structure helps you explore neighbors systematically?',
        2: 'Consider using Depth-First Search (DFS) or Breadth-First Search (BFS). Each time you find an unvisited land cell, start a traversal and mark all connected cells as visited.',
        3: 'Use a visited set or modify the grid in-place. For each unvisited "1", increment your island counter and run DFS/BFS to mark all connected "1"s as visited. The key insight: each DFS/BFS call represents one complete island.'
      }
      return {
        hint: hints[hint_level] || hints[1],
        hint_level,
        problem_id
      }
    }
    return this.request('/recommendations/hint', {
      method: 'POST',
      body: JSON.stringify({
        problem_id,
        user_id,
        problem_description,
        hint_level,
      }),
    })
  }

  // Helper: Get current user from localStorage
  getCurrentUser(): User | null {
    if (typeof window === 'undefined') return null
    const userStr = localStorage.getItem('user')
    return userStr ? JSON.parse(userStr) : null
  }

  // Helper: Check if user is authenticated
  isAuthenticated(): boolean {
    return !!this.accessToken
  }
}

// Export singleton instance
export const api = new APIClient(API_URL)

// Export for use in components
export default api
