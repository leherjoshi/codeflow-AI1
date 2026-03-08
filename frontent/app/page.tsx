"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  Sparkles,
  Brain,
  Map,
  MessageSquare,
  Code,
  ArrowRight,
  Github,
  Twitter,
  AlertCircle,
} from "lucide-react"
import ThemeToggle from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth-context"

export default function Home() {
  const [username, setUsername] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const { isAuthenticated } = useAuth()

  const handleAnalyze = () => {
    if (!username.trim()) {
      setError("Please enter a LeetCode username")
      return
    }

    setError("")
    
    // If user is authenticated, go to dashboard
    // If not, redirect to register with username pre-filled
    if (isAuthenticated) {
      router.push("/dashboard")
    } else {
      router.push(`/auth/register?username=${encodeURIComponent(username)}`)
    }
  }

  const features = [
    {
      icon: Brain,
      title: "AI Weakness Detection",
      description: "Analyze your LeetCode profile to identify weak topics",
    },
    {
      icon: Map,
      title: "Smart Roadmaps",
      description: "Get personalized learning paths based on your skills",
    },
    {
      icon: MessageSquare,
      title: "AI Mentor Chat",
      description: "24/7 AI mentor to answer your coding questions",
    },
    {
      icon: Code,
      title: "Interview Simulator",
      description: "Practice with AI-powered mock interviews",
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      {/* Gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-100/30 via-gray-50 to-pink-100/30 dark:from-purple-900/20 dark:via-black dark:to-pink-900/20" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-100/30 via-transparent to-transparent dark:from-purple-900/20 dark:via-black dark:to-transparent" />

      {/* Navbar */}
      <nav className="relative z-10 border-b border-gray-200 backdrop-blur-xl dark:border-white/10">
        <div className="container mx-auto flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-xl font-bold text-transparent dark:from-purple-400 dark:to-pink-400">
              CodeFlow AI
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Features
            </a>
            <a
              href="#"
              className="text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Pricing
            </a>
            <ThemeToggle />
            <a
              href="/auth/login"
              className="text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
            >
              Sign In
            </a>
            <a
              href="/auth/register"
              className="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-purple-500/50"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative z-10 container mx-auto px-6 pt-20 pb-32">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-4xl text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-purple-300 bg-purple-100 px-4 py-2 backdrop-blur-xl dark:border-purple-500/20 dark:bg-purple-500/10"
          >
            <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <span className="text-sm text-purple-700 dark:text-purple-300">
              Powered by AI • Trusted by 10,000+ developers
            </span>
          </motion.div>

          <h1 className="mb-6 bg-gradient-to-r from-gray-900 via-purple-800 to-pink-800 bg-clip-text text-6xl font-bold leading-tight text-transparent dark:from-white dark:via-purple-200 dark:to-pink-200">
            Master Competitive Programming with AI
          </h1>

          <p className="mb-12 text-xl text-gray-600 dark:text-gray-400">
            Analyze your LeetCode profile and get a personalized learning
            roadmap. <br />
            Powered by advanced AI to accelerate your coding journey.
          </p>

          {/* Input Box */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mx-auto max-w-2xl"
          >
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10"
              >
                <AlertCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </motion.div>
            )}
            
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 opacity-75 blur-lg"></div>
              <div className="relative flex gap-2 rounded-2xl border border-gray-300 bg-white/80 p-2 backdrop-blur-xl dark:border-white/20 dark:bg-black/50">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setError("")
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  placeholder="Enter your LeetCode username..."
                  disabled={isLoading}
                  className="flex-1 bg-transparent px-4 py-3 text-gray-900 placeholder-gray-500 focus:outline-none disabled:opacity-50 dark:text-white dark:placeholder-gray-400"
                />
                <button
                  onClick={handleAnalyze}
                  disabled={isLoading}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 px-6 py-3 font-medium text-white transition-all hover:shadow-lg hover:shadow-purple-500/50 disabled:opacity-50"
                >
                  {isLoading ? "Analyzing..." : "Analyze Profile"}
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-500">
              Free forever • No credit card required
            </p>
          </motion.div>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mx-auto mt-32 grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-4"
        >
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.7 + index * 0.1 }}
              className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-sm backdrop-blur-xl transition-all hover:border-purple-500/50 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 opacity-0 transition-opacity group-hover:opacity-10" />
              <div className="relative">
                <div className="mb-4 inline-flex rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-3">
                  <feature.icon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">
                  {feature.title}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-200 py-8 dark:border-white/10">
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              © 2024 CodeFlow AI. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="#"
                className="text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              >
                <Twitter className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
