"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import RoadmapCard from "@/components/roadmap-card"
import { Calendar, Target, Loader2 } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { api, Problem } from "@/lib/api"

export default function RoadmapPage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [roadmap, setRoadmap] = useState<Problem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")
  const [completedProblems, setCompletedProblems] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/auth/login")
      return
    }

    if (user) {
      fetchRoadmap()
    }
  }, [user, isAuthenticated, authLoading, router])

  const fetchRoadmap = async () => {
    if (!user) return

    setIsLoading(true)
    setError("")

    try {
      // First get topics to identify weak areas
      const topicsData = await api.getTopics(user.user_id)
      
      const weakTopics = Object.entries(topicsData.topics)
        .filter(([_, data]) => data.classification === "weak")
        .map(([topic]) => topic)

      const strongTopics = Object.entries(topicsData.topics)
        .filter(([_, data]) => data.classification === "strong")
        .map(([topic]) => topic)

      // Generate learning path
      const pathData = await api.generateLearningPath(
        user.user_id,
        weakTopics.length > 0 ? weakTopics : undefined,
        strongTopics.length > 0 ? strongTopics : undefined
      )

      setRoadmap(pathData.problems)
    } catch (err: any) {
      console.error("Failed to fetch roadmap:", err)
      setError(err.message || "Failed to load learning roadmap")
    } finally {
      setIsLoading(false)
    }
  }

  const toggleComplete = (leetcodeId: string) => {
    setCompletedProblems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(leetcodeId)) {
        newSet.delete(leetcodeId)
      } else {
        newSet.add(leetcodeId)
      }
      return newSet
    })
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-purple-600 dark:text-purple-400" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Generating your roadmap...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={fetchRoadmap}
            className="mt-4 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-2 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const completedCount = completedProblems.size
  const totalCount = roadmap.length
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Learning Roadmap</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Your personalized path to mastering competitive programming
        </p>
      </motion.div>

      {/* Progress Overview */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Overall Progress
            </h3>
          </div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {completedCount} of {totalCount} completed
          </span>
        </div>

        {/* Progress Bar */}
        <div className="relative h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ delay: 0.3, duration: 1, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
          />
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <Calendar className="h-4 w-4" />
          <span>
            {totalCount > 0
              ? `${totalCount} problems • Estimated ${Math.ceil(totalCount / 3)} days`
              : "No problems yet"}
          </span>
        </div>
      </motion.div>

      {/* Roadmap Items */}
      {roadmap.length > 0 ? (
        <div className="space-y-4">
          {roadmap.map((problem, index) => (
            <div
              key={problem.leetcode_id}
              onClick={() => toggleComplete(problem.leetcode_id)}
              className="cursor-pointer"
            >
              <RoadmapCard
                day={index + 1}
                title={problem.title}
                topic={problem.topics[0] || "General"}
                difficulty={problem.difficulty}
                completed={completedProblems.has(problem.leetcode_id)}
                delay={0.2 + index * 0.05}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center dark:border-white/10 dark:bg-white/5">
          <p className="text-gray-600 dark:text-gray-400">
            No roadmap available. Complete your profile analysis first.
          </p>
        </div>
      )}

      {/* Next Steps */}
      {roadmap.length > 0 && completedCount < totalCount && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-pink-50 p-6 shadow-sm dark:border-purple-500/20 dark:from-purple-500/10 dark:to-pink-500/10 dark:backdrop-blur-xl"
        >
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
            🎯 Next Recommended Action
          </h3>
          <p className="text-gray-700 dark:text-gray-300">
            {roadmap[completedCount]
              ? `Start with "${roadmap[completedCount].title}" to strengthen your ${roadmap[completedCount].topics[0]} skills.`
              : "Complete the remaining problems to finish your roadmap!"}
          </p>
          {roadmap[completedCount] && (
            <a
              href={`https://leetcode.com/problems/${roadmap[completedCount].leetcode_id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-purple-500/50"
            >
              Start on LeetCode
            </a>
          )}
        </motion.div>
      )}
    </div>
  )
}
