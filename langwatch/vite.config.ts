import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const FRONTEND_PORT = parseInt(process.env.PORT ?? "5560");
const API_PORT = FRONTEND_PORT + 1000;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Path aliases (matching tsconfig paths)
      "~": path.resolve(__dirname, "./src"),
      "@app": path.resolve(__dirname, "./src/server/app-layer"),

      // Browser stubs for Node.js-only modules
      "pino-pretty": path.resolve(__dirname, "./src/noop-css.cjs"),
      "pino": path.resolve(__dirname, "node_modules/pino/browser.js"),
    },
  },
  define: {
    // Literal replacements for process.env references in browser code.
    // Vite auto-handles NODE_ENV but not arbitrary env vars.
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
    "process.env.PINO_LOG_LEVEL": JSON.stringify("info"),
    // Catch-all: prevent ReferenceError for any other process.env.* access
    // that slips into client code (e.g. dead branches behind typeof window checks)
    "process.env.BASE_HOST": "undefined",
    "process.env.PORT": "undefined",
    "process.env.SKIP_ENV_VALIDATION": "undefined",
    "process.env.BUILD_TIME": "undefined",
    "process.env.VERCEL": "undefined",
    "process.env.VERCEL_URL": "undefined",
  },
  build: {
    outDir: "dist/client",
    sourcemap: true,
  },
  server: {
    watch: {
      ignored: [
        "**/.git/**",
        "**/node_modules/.pnpm/**",
        "**/.pnpm-store/**",
        "**/dist/**",
        "**/.next/**",
        "**/coverage/**",
        "**/server.log",
      ],
    },
    // Frontend port (default 5560, configurable via PORT env var)
    host: true,
    allowedHosts: true,
    port: FRONTEND_PORT,
    strictPort: true,
    // Proxy API requests to the Hono backend (PORT + 1000)
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
