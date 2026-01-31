import type { Metadata } from "next";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";
import AuthButton from "@/components/AuthButton";

export const metadata: Metadata = {
  title: "RollCloud Dashboard",
  description: "Admin dashboard for RollCloud Discord integration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SessionProvider>
          <nav className="bg-green-600 text-white p-4 shadow-lg">
            <div className="container mx-auto flex items-center justify-between">
              <a href="/" className="flex items-center space-x-2 hover:opacity-90 transition">
                <img src="/logo.png" alt="RollCloud" className="w-8 h-8" />
                <h1 className="text-xl font-bold">RollCloud</h1>
              </a>
              <div className="flex items-center space-x-6">
                <a href="/" className="hover:text-green-200 transition">Home</a>
                <a href="/setup" className="hover:text-green-200 transition">Setup</a>
                <a href="/configure-pip" className="hover:text-green-200 transition">Configure Pip</a>
                <AuthButton />
              </div>
            </div>
          </nav>
          <main className="container mx-auto p-6">
            {children}
          </main>
          <footer className="border-t border-gray-200 dark:border-gray-700 mt-8 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            RollCloud v1.2.7
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
