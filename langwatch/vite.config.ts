import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

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
    // Ensure process.env references don't crash in the browser
    "process.env.PINO_LOG_LEVEL": JSON.stringify("info"),
    // Global process shim for libraries that check process at top level
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  build: {
    outDir: "dist/client",
    sourcemap: true,
  },
  server: {
    // Frontend always on 5560 — same port as with Next.js
    port: 5560,
    strictPort: true,
    // Proxy API requests to the Hono backend (internal port)
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT ?? "5565"}`,
        changeOrigin: true,
      },
    },
  },
  // Load .snippet files as raw strings (previously handled by webpack/turbopack)
  assetsInclude: [
    "**/*.snippet.sts",
    "**/*.snippet.go",
    "**/*.snippet.sh",
    "**/*.snippet.py",
    "**/*.snippet.yaml",
  ],
});
