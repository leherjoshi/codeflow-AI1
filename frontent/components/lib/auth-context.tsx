"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { api, User } from './api'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (leetcode_username: string, password: string) => Promise<void>
  register: (leetcode_username: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check if user is already logged in
    const currentUser = api.getCurrentUser()
    if (currentUser) {
      setUser(currentUser)
    }
    setIsLoading(false)
  }, [])

  const login = async (leetcode_username: string, password: string) => {
    try {
      const response = await api.login(leetcode_username, password)
      if (response.user) {
        setUser(response.user)
        
        // Trigger profile data pipeline: Scrape → Analyze
        try {
          console.log('Step 1: Fetching LeetCode profile data for:', response.user.leetcode_username)
          await api.fetchProfile(response.user.user_id, response.user.leetcode_username)
          console.log('Step 2: Profile data fetched and cached successfully')
          
          console.log('Step 3: Analyzing cached profile data')
          await api.analyzeProfile(response.user.user_id, response.user.leetcode_username)
          console.log('Step 4: Profile analysis completed')
        } catch (analysisError) {
          console.error('Profile data pipeline failed (non-blocking):', analysisError)
          // Don't block login if scraping/analysis fails - it can be retried later
        }
      }
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  const register = async (leetcode_username: string, email: string, password: string) => {
    try {
      const response = await api.register(leetcode_username, email, password)
      // After registration, we need to get the user info
      const currentUser = api.getCurrentUser()
      if (currentUser) {
        setUser(currentUser)
        
        // Trigger profile data pipeline: Scrape → Analyze
        try {
          console.log('Step 1: Fetching LeetCode profile data for:', currentUser.leetcode_username)
          await api.fetchProfile(currentUser.user_id, currentUser.leetcode_username)
          console.log('Step 2: Profile data fetched and cached successfully')
          
          console.log('Step 3: Analyzing cached profile data')
          await api.analyzeProfile(currentUser.user_id, currentUser.leetcode_username)
          console.log('Step 4: Profile analysis completed')
        } catch (analysisError) {
          console.error('Profile data pipeline failed (non-blocking):', analysisError)
          // Don't block registration if scraping/analysis fails - it can be retried later
        }
      }
    } catch (error) {
      console.error('Registration failed:', error)
      throw error
    }
  }

  const logout = () => {
    api.clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
