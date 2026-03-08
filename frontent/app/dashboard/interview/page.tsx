"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import ProblemCard from "@/components/problem-card"
import { Play, Clock, CheckCircle2, Sparkles, Loader2, Lightbulb } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { api, Problem } from "@/lib/api"

export default function InterviewPage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [problem, setProblem] = useState<Problem | null>(null)
  const [currentHint, setCurrentHint] = useState("")
  const [hintLevel, setHintLevel] = useState<1 | 2 | 3>(1)
  const [isStarted, setIsStarted] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingHint, setIsLoadingHint] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/auth/login")
      return
    }

    if (user) {
      fetchProblem()
    }
  }, [user, isAuthenticated, authLoading, router])

  const fetchProblem = async () => {
    if (!user) return

    setIsLoading(true)
    setError("")

    try {
      const nextProblem = await api.getNextProblem(user.user_id)
      setProblem(nextProblem.problem)
    } catch (err: any) {
      console.error("Failed to fetch problem:", err)
      setError(err.message || "Failed to load interview problem")
    } finally {
      setIsLoading(false)
    }
  }

  const handleGetHint = async () => {
    if (!user || !problem) return

    setIsLoadingHint(true)
    setError("")

    try {
      const hintData = await api.generateHint(
        problem.leetcode_id,
        user.user_id,
        `Problem: ${problem.title}. Topics: ${problem.topics.join(", ")}`,
        hintLevel
      )
      setCurrentHint(hintData.hint)
      
      // Increment hint level for next time (max 3)
      if (hintLevel < 3) {
        setHintLevel((prev) => (prev + 1) as 1 | 2 | 3)
      }
    } catch (err: any) {
      console.error("Failed to get hint:", err)
      setError(err.message || "Failed to generate hint")
    } finally {
      setIsLoadingHint(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-purple-600 dark:text-purple-400" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading interview...</p>
        </div>
      </div>
    )
  }

  if (error && !problem) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={fetchProblem}
            className="mt-4 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-2 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!problem) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">No problem available</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Interview Simulator</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Practice coding interviews with AI-powered feedback
        </p>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="grid gap-4 md:grid-cols-3"
      >
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Current Problem</span>
            <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
            {problem.difficulty}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Topics</span>
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <p className="mt-2 text-lg font-bold text-gray-900 dark:text-white">
            {problem.topics.slice(0, 2).join(", ")}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">Est. Time</span>
            <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
            {problem.estimated_time_minutes} min
          </p>
        </div>
      </motion.div>

      {/* Problem Card */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <ProblemCard
          title={problem.title}
          difficulty={problem.difficulty}
          description={problem.reason || `Practice problem focusing on ${problem.topics.join(", ")}`}
        />
      </motion.div>

      {/* Problem Details */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl"
      >
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          Problem Details
        </h3>

        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
              Topics Covered:
            </h4>
            <div className="flex flex-wrap gap-2">
              {problem.topics.map((topic, index) => (
                <span
                  key={index}
                  className="rounded-lg bg-purple-100 px-3 py-1 text-sm text-purple-700 dark:bg-purple-500/20 dark:text-purple-300"
                >
                  {topic.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </span>
              ))}
            </div>
          </div>

          {problem.reason && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                Why this problem?
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300">{problem.reason}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3">
          <a
            href={`https://leetcode.com/problems/${problem.leetcode_id}/`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsStarted(true)}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-3 font-medium text-white transition-all hover:shadow-lg hover:shadow-purple-500/50"
          >
            <Play className="h-4 w-4" />
            {isStarted ? "Continue on LeetCode" : "Start on LeetCode"}
          </a>
          <button
            onClick={handleGetHint}
            disabled={isLoadingHint}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-3 font-medium text-gray-900 transition-all hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
          >
            {isLoadingHint ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lightbulb className="h-4 w-4" />
            )}
            Get Hint {hintLevel > 1 && `(Level ${hintLevel})`}
          </button>
        </div>
      </motion.div>

      {/* Hint Display */}
      {currentHint && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="rounded-xl border border-yellow-200 bg-gradient-to-br from-yellow-50 to-orange-50 p-6 shadow-sm dark:border-yellow-500/20 dark:from-yellow-500/10 dark:to-orange-500/10 dark:backdrop-blur-xl"
        >
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Hint (Level {hintLevel - 1})
            </h3>
          </div>
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{currentHint}</p>
        </motion.div>
      )}

      {/* AI Feedback Panel */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-6 shadow-sm dark:border-purple-500/20 dark:from-purple-500/10 dark:to-pink-500/10 dark:backdrop-blur-xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Tips for Success</h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Understand the Problem</p>
              <p className="text-sm text-gray-700 dark:text-gray-400">
                Read carefully and identify edge cases before coding
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Plan Your Approach</p>
              <p className="text-sm text-gray-700 dark:text-gray-400">
                Think about time and space complexity before implementing
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Test Thoroughly</p>
              <p className="text-sm text-gray-700 dark:text-gray-400">
                Verify your solution with multiple test cases
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
