import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Override green with magenta branding
        green: {
          50: '#FEDAFE',
          100: '#FDE1FE',
          200: '#FCB8FC',
          300: '#FC8FFB',
          400: '#FC66FA',
          500: '#FC57F9',
          600: '#8E0682', // Dark magenta for navbar
          700: '#C046C7',
          800: '#8E0682',
          900: '#6A0562',
        },
        emerald: {
          600: '#FC57F9',
        },
      },
    },
  },
  plugins: [],
};

export default config;
