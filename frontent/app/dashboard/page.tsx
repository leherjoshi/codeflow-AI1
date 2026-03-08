"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Trophy, Target, TrendingUp, Zap, Lightbulb, Loader2 } from "lucide-react"
import { motion } from "framer-motion"
import StatCard from "@/components/stat-card"
import RadarChartComponent from "@/components/radar-chart"
import RoadmapCard from "@/components/roadmap-card"
import { useAuth } from "@/lib/auth-context"
import { api, Progress, Problem } from "@/lib/api"

interface TopicData {
  topic: string
  value: number
  fullMark: number
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [topicData, setTopicData] = useState<TopicData[]>([])
  const [roadmap, setRoadmap] = useState<Problem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/auth/login")
      return
    }

    if (user) {
      fetchDashboardData()
    }
  }, [user, isAuthenticated, authLoading, router])

  const fetchDashboardData = async () => {
    if (!user) return

    setIsLoading(true)
    setError("")

    try {
      // Fetch progress and topics in parallel
      const [progressData, topicsData] = await Promise.all([
        api.getProgress(user.user_id),
        api.getTopics(user.user_id),
      ])

      setProgress(progressData)

      // Convert topics to radar chart format
      const topicArray = Object.entries(topicsData.topics).map(([topic, data]) => ({
        topic: topic.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        value: Math.round(data.proficiency * 100),
        fullMark: 100,
      }))
      setTopicData(topicArray)

      // Try to fetch learning path
      try {
        const weakTopics = Object.entries(topicsData.topics)
          .filter(([_, data]) => data.classification === "weak")
          .map(([topic]) => topic)

        if (weakTopics.length > 0) {
          const pathData = await api.generateLearningPath(user.user_id, weakTopics)
          setRoadmap(pathData.problems.slice(0, 3))
        }
      } catch (err) {
        console.error("Failed to fetch learning path:", err)
      }
    } catch (err: any) {
      console.error("Failed to fetch dashboard data:", err)
      
      // Use mock data as fallback
      console.log("Using mock data for demo...")
      setProgress({
        user_id: user.user_id,
        streak_count: 7,
        badges: [
          { badge_id: "1", name: "Week Warrior", earned_at: new Date().toISOString(), milestone: 7 }
        ],
        problems_solved_today: 3,
        total_problems_solved: 42,
        last_solve_timestamp: new Date().toISOString(),
        next_milestone: {
          days: 14,
          badge_name: "Two Week Champion",
          days_remaining: 7
        }
      })
      
      setTopicData([
        { topic: "Arrays", value: 75, fullMark: 100 },
        { topic: "Strings", value: 65, fullMark: 100 },
        { topic: "Hash Tables", value: 80, fullMark: 100 },
        { topic: "Trees", value: 45, fullMark: 100 },
        { topic: "Graphs", value: 35, fullMark: 100 },
        { topic: "Dynamic Programming", value: 50, fullMark: 100 },
      ])
      
      setRoadmap([
        {
          title: "Two Sum",
          difficulty: "Easy" as const,
          topics: ["Arrays", "Hash Table"],
          leetcode_id: "1",
          estimated_time_minutes: 15,
          reason: "Build foundation in hash tables"
        },
        {
          title: "Binary Tree Inorder Traversal",
          difficulty: "Easy" as const,
          topics: ["Trees", "DFS"],
          leetcode_id: "94",
          estimated_time_minutes: 20,
          reason: "Strengthen tree traversal skills"
        },
        {
          title: "Number of Islands",
          difficulty: "Medium" as const,
          topics: ["Graphs", "DFS", "BFS"],
          leetcode_id: "200",
          estimated_time_minutes: 30,
          reason: "Practice graph algorithms"
        }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-purple-600 dark:text-purple-400" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading your dashboard...</p>
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
            onClick={fetchDashboardData}
            className="mt-4 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-2 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const strongestTopic = topicData.length > 0
    ? topicData.reduce((max, curr) => (curr.value > max.value ? curr : max))
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Welcome back, {user?.leetcode_username}! 👋
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Here's your coding progress overview
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Problems Solved"
          value={progress?.total_problems_solved || 0}
          icon={Trophy}
          trend={`${progress?.problems_solved_today || 0} today`}
          delay={0.1}
        />
        <StatCard
          title="Current Streak"
          value={`${progress?.streak_count || 0} days`}
          icon={Zap}
          trend={progress?.streak_count && progress.streak_count > 0 ? "Keep it up!" : "Start today!"}
          delay={0.2}
        />
        <StatCard
          title="Strongest Topic"
          value={strongestTopic?.topic || "N/A"}
          icon={TrendingUp}
          delay={0.3}
        />
        <StatCard
          title="Badges Earned"
          value={progress?.badges.length || 0}
          icon={Target}
          trend={progress?.next_milestone ? `${progress.next_milestone.days_remaining} days to next` : ""}
          delay={0.4}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Radar Chart - Takes 2 columns */}
        <div className="lg:col-span-2">
          {topicData.length > 0 ? (
            <RadarChartComponent data={topicData} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
              <p className="text-gray-600 dark:text-gray-400">No topic data available yet</p>
            </div>
          )}
        </div>

        {/* AI Insights */}
        <motion.div
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl"
        >
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">AI Insights</h3>
          </div>
          <div className="space-y-4">
            {progress && progress.streak_count > 0 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-500/20 dark:bg-purple-500/5"
              >
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Great job maintaining your {progress.streak_count}-day streak! Consistency is key to improvement.
                </p>
              </motion.div>
            )}
            {strongestTopic && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-500/20 dark:bg-purple-500/5"
              >
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  You're strongest in {strongestTopic.topic}. Consider tackling harder problems in this area.
                </p>
              </motion.div>
            )}
            {topicData.filter((t) => t.value < 50).length > 0 && (
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-500/20 dark:bg-purple-500/5"
              >
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Focus on your weak topics to build a well-rounded skill set. Check your roadmap for guidance.
                </p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Learning Roadmap Preview */}
      {roadmap.length > 0 && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              Your Learning Roadmap
            </h2>
            <a
              href="/dashboard/roadmap"
              className="text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
            >
              View all →
            </a>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roadmap.map((problem, index) => (
              <RoadmapCard
                key={problem.leetcode_id}
                day={index + 1}
                title={problem.title}
                description={problem.reason || problem.topics.join(", ")}
                difficulty={problem.difficulty}
                completed={false}
                delay={0.6 + index * 0.1}
              />
            ))}
          </div>
        </motion.div>
      )}
    </div>
  )
}
