import Sidebar from "@/components/sidebar"
import Navbar from "@/components/navbar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      {/* Gradient background */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-100/30 via-gray-50 to-pink-100/30 dark:from-purple-900/20 dark:via-black dark:to-pink-900/20" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-purple-100/30 via-transparent to-transparent dark:from-purple-900/20 dark:via-black dark:to-transparent" />

      <Sidebar />
      <div className="pl-64">
        <Navbar />
        <main className="relative z-10 p-6">{children}</main>
      </div>
    </div>
  )
}
