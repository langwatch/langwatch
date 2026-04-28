import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const FRONTEND_PORT = parseInt(process.env.PORT ?? "5560");
const API_PORT = FRONTEND_PORT + 1000;

// object-inspect's index.js does `var inspectCustom = require('./util.inspect')`
// and the package.json sets `"browser": { "./util.inspect.js": false }`. Vite
// turns `false` into a Proxy stub that throws on ANY property access — which
// breaks object-inspect's `typeof inspectCustom.custom === 'symbol'` defensive
// check (it expected `false` → empty `{}`, but vite gives a throwing stub).
// Result before this plugin: the SPA failed to mount and threw `Cannot access
// ".custom" in client code` in the command-bar chunk.
//
// Fix: intercept the relative `./util.inspect` import from inside object-inspect
// and route it to our noop module. Vite's `resolve.alias` can't catch this
// because the alias key would have to match the relative specifier, but only
// from one specific importer. A `resolveId` plugin with an importer check is
// the right tool.
function patchObjectInspectBrowserStub(): Plugin {
  const noopPath = path.resolve(__dirname, "./src/noop-css.cjs");
  return {
    name: "patch-object-inspect-browser-stub",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === "./util.inspect" && importer && importer.includes("/object-inspect/")) {
        return noopPath;
      }
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [react(), patchObjectInspectBrowserStub()],
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
    // Proxy API requests to the Hono backend (PORT + 1000). `ws: true`
    // forwards WebSocket upgrades for the tRPC WS transport at /api/trpc-ws.
    proxy: {
      "/api": {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
