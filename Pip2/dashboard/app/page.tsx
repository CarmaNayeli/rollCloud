export default function Home() {
  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-green-500 to-green-800 text-white rounded-lg shadow-xl p-8">
        <h1 className="text-4xl font-bold mb-4">RollCloud</h1>
        <p className="text-xl opacity-90">
          Sync your DiceCloud V2 characters to Roll20 with Discord turn notifications
        </p>
      </div>

      {/* Main Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-2">Get Started</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Download the extension and set up Discord integration
          </p>
          <a
            href="/setup"
            className="inline-block bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
          >
            Setup Guide
          </a>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-2">Configure Pip</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Manage slash commands and permissions for servers where you're an admin
          </p>
          <a
            href="/configure-pip"
            className="inline-block bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
          >
            Configure Commands
          </a>
        </div>
      </div>

      {/* Quick Links */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-2xl font-bold mb-4">Quick Links</h2>
        <div className="flex flex-wrap gap-4">
          <a
            href="https://github.com/CarmaNayeli/rollCloud/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
          >
            Download RollCloud
          </a>
          <a
            href="https://github.com/CarmaNayeli/rollCloud"
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-600 dark:text-green-400 hover:underline"
          >
            GitHub Repository
          </a>
          <a
            href="/api/health"
            target="_blank"
            className="text-green-600 dark:text-green-400 hover:underline"
          >
            API Health Check
          </a>
        </div>
      </div>

      {/* Commands Reference */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-2xl font-bold mb-4">Discord Commands</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-lg mb-2 text-green-600 dark:text-green-400">RollCloud</h3>
            <ul className="space-y-2 text-sm font-mono">
              <li><code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/rollcloud pair</code> - Link channel to character</li>
              <li><code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/rollcloud status</code> - Check pairing status</li>
              <li><code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/roll [dice]</code> - Roll dice (e.g., 2d6+3)</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2 text-green-600 dark:text-green-400">Utility</h3>
            <ul className="space-y-2 text-sm font-mono">
              <li><code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/ping</code> - Check bot responsiveness</li>
              <li><code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">/help</code> - Show help information</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
