"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import AIChat from "@/components/ai-chat"
import { Sparkles, Zap, Brain, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

export default function MentorPage() {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) {
    return (
      <div className="flex h-[600px] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600 dark:text-purple-400" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">AI Mentor</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Get instant help from your personal AI coding mentor
        </p>
      </motion.div>

      {/* Quick Tips */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="grid gap-4 md:grid-cols-3"
      >
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Ask Anything
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Get help with algorithms, data structures, or debugging
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Instant Responses
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Powered by advanced AI for quick, accurate answers
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Brain className="h-4 w-4 text-pink-600 dark:text-pink-400" />
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              Personalized
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Tailored advice based on your LeetCode profile
          </p>
        </div>
      </motion.div>

      {/* Chat Interface */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="h-[600px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl"
      >
        <AIChat />
      </motion.div>

      {/* Suggested Questions */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <h3 className="mb-3 text-sm font-medium text-gray-600 dark:text-gray-400">
          Suggested Questions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            "How do I improve my DP skills?",
            "Explain BFS vs DFS",
            "Best way to practice graphs?",
            "Time complexity of quicksort?",
          ].map((question, index) => (
            <button
              key={index}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 shadow-sm transition-all hover:border-purple-500/50 hover:bg-gray-50 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:backdrop-blur-xl dark:hover:bg-white/10 dark:hover:text-white"
            >
              {question}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
