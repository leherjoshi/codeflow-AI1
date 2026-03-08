"use client"

import { Clock, Code } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface ProblemCardProps {
  title: string
  difficulty: "Easy" | "Medium" | "Hard"
  description: string
  timeEstimate?: string
}

const difficultyColors = {
  Easy: "text-green-400 bg-green-500/10 border-green-500/20",
  Medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Hard: "text-red-400 bg-red-500/10 border-red-500/20",
}

export default function ProblemCard({
  title,
  difficulty,
  description,
  timeEstimate = "30 min",
}: ProblemCardProps) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-purple-500/50 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl dark:hover:bg-white/10"
    >
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 opacity-0 transition-opacity group-hover:opacity-10" />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{description}</p>
          </div>
          <Code className="h-5 w-5 text-purple-600 dark:text-purple-400" />
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
              difficultyColors[difficulty]
            )}
          >
            {difficulty}
          </span>
          <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
            <Clock className="h-3 w-3" />
            <span>{timeEstimate}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
