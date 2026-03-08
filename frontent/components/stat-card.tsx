"use client"

import { LucideIcon } from "lucide-react"
import { motion } from "framer-motion"

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  trend?: string
  delay?: number
}

export default function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  delay = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay }}
      className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-purple-500/50 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl dark:hover:bg-white/10"
    >
      {/* Gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 opacity-0 transition-opacity group-hover:opacity-10" />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
          {trend && (
            <p className="mt-2 text-xs text-green-600 dark:text-green-400">↑ {trend}</p>
          )}
        </div>
        <div className="rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-3">
          <Icon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
        </div>
      </div>
    </motion.div>
  )
}
