"use client"

import { motion } from "framer-motion"
import { useTheme } from "next-themes"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts"

interface RadarChartComponentProps {
  data: Array<{ topic: string; value: number; fullMark: number }>
}

export default function RadarChartComponent({ data }: RadarChartComponentProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 0.2 }}
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl"
    >
      <h3 className="mb-6 text-lg font-semibold text-gray-900 dark:text-white">Topic Mastery</h3>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data}>
          <PolarGrid stroke={isDark ? "#ffffff20" : "#00000020"} />
          <PolarAngleAxis
            dataKey="topic"
            tick={{ fill: isDark ? "#9ca3af" : "#6b7280", fontSize: 12 }}
          />
          <PolarRadiusAxis 
            angle={90} 
            domain={[0, 100]} 
            tick={{ fill: isDark ? "#9ca3af" : "#6b7280" }} 
          />
          <Radar
            name="Mastery"
            dataKey="value"
            stroke="#a855f7"
            fill="#a855f7"
            fillOpacity={0.6}
          />
        </RadarChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
