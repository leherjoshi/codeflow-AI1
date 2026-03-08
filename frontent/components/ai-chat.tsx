"use client"

import { useState } from "react"
import { Send, Sparkles, Loader2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: string
  intent?: string
  cached?: boolean
}

interface AIChatProps {
  initialMessages?: Message[]
  code?: string
  problemId?: string
}

export default function AIChat({ initialMessages = [], code, problemId }: AIChatProps) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSend = async () => {
    if (!input.trim() || !user) return

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setError("")

    try {
      const response = await api.chatMentor(
        user.user_id,
        input,
        code,
        problemId
      )

      const aiMessage: Message = {
        role: "assistant",
        content: response.response,
        timestamp: new Date().toISOString(),
        intent: response.intent,
        cached: response.cached,
      }

      setMessages((prev) => [...prev, aiMessage])
    } catch (err: any) {
      console.error("Chat error:", err)
      
      // Check if it's an authentication error
      if (err.message && err.message.includes('Authentication failed')) {
        setError("Your session has expired. Please log in again.")
        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.href = '/auth/login'
        }, 2000)
      } else {
        setError(err.message || "Failed to get response from AI mentor")
      }
      
      // Add error message to chat
      const errorMessage: Message = {
        role: "assistant",
        content: err.message && err.message.includes('Authentication failed')
          ? "Your session has expired. Redirecting to login..."
          : "Sorry, I'm having trouble responding right now. Please try again.",
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        <AnimatePresence>
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className={`flex ${
                message.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                    : "border border-gray-200 bg-gray-50 text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:backdrop-blur-xl"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                    <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                      AI Mentor
                      {message.cached && " • Cached"}
                    </span>
                  </div>
                )}
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                {message.intent && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Intent: {message.intent.replace(/_/g, " ")}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex justify-start"
          >
            <div className="max-w-[80%] rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/5 dark:backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-purple-600 dark:text-purple-400" />
                <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                  AI Mentor is thinking...
                </span>
              </div>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 dark:border-white/10">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask your AI mentor anything..."
            disabled={isLoading}
            className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-500 transition-all focus:border-purple-500/50 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder-gray-400 dark:backdrop-blur-xl"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || !user}
            className="rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 p-3 text-white transition-all hover:shadow-lg hover:shadow-purple-500/50 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
