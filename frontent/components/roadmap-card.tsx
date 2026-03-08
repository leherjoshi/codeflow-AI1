"use client"

import { CheckCircle2, Circle } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface RoadmapCardProps {
  day: number
  title: string
  description: string
  difficulty: "Easy" | "Medium" | "Hard"
  completed: boolean
  delay?: number
}

const difficultyColors = {
  Easy: "text-green-400 bg-green-500/10 border-green-500/20",
  Medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Hard: "text-red-400 bg-red-500/10 border-red-500/20",
}

export default function RoadmapCard({
  day,
  title,
  description,
  difficulty,
  completed,
  delay = 0,
}: RoadmapCardProps) {
  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay }}
      className={cn(
        "group relative overflow-hidden rounded-xl border p-6 shadow-sm transition-all hover:border-purple-500/50 dark:backdrop-blur-xl",
        completed
          ? "border-green-500/20 bg-green-500/5"
          : "border-gray-200 bg-white hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
      )}
    >
      <div className="flex items-start gap-4">
        {/* Day indicator */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20">
          <span className="text-lg font-bold text-gray-900 dark:text-white">D{day}</span>
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">{title}</h4>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
            </div>
            {completed ? (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <Circle className="h-5 w-5 text-gray-400 dark:text-gray-600" />
            )}
          </div>

          {/* Difficulty badge */}
          <div className="mt-3">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                difficultyColors[difficulty]
              )}
            >
              {difficulty}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
