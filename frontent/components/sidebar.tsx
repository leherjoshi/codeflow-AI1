"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Map,
  MessageSquare,
  Code,
  Sparkles,
  LogOut,
} from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/roadmap", icon: Map, label: "Roadmap" },
  { href: "/dashboard/mentor", icon: MessageSquare, label: "AI Mentor" },
  { href: "/dashboard/interview", icon: Code, label: "Interview" },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()

  const handleLogout = () => {
    logout()
    router.push("/")
  }

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-gray-200 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-black/50"
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6 dark:border-white/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-xl font-bold text-transparent dark:from-purple-400 dark:to-pink-400">
            CodeFlow
          </span>
        </div>

        {/* User Info */}
        {user && (
          <div className="border-b border-gray-200 px-4 py-3 dark:border-white/10">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {user.leetcode_username}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {user.language_preference === "en" ? "English" : user.language_preference}
            </p>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                  isActive
                    ? "bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-gray-900 dark:text-white"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <item.icon className="relative h-5 w-5" />
                <span className="relative">{item.label}</span>
              </Link>
            )
          })}

          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-all hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <LogOut className="relative h-5 w-5" />
            <span className="relative">Logout</span>
          </button>
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-200 p-4 dark:border-white/10">
          <div className="rounded-lg bg-gradient-to-br from-purple-500/10 to-pink-500/10 p-4">
            <p className="text-xs font-medium text-gray-900 dark:text-white">Upgrade to Pro</p>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Unlock advanced AI features
            </p>
            <button className="mt-3 w-full rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 py-2 text-xs font-medium text-white transition-all hover:shadow-lg hover:shadow-purple-500/50">
              Upgrade Now
            </button>
          </div>
        </div>
      </div>
    </motion.aside>
  )
}
