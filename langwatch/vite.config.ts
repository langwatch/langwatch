import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { generate as generateSelfsigned } from "selfsigned";

// Load `.env` into the Vite config's process environment. Vite normally
// only exposes `VITE_*` vars to client code — but this config itself
// runs in Node and needs access to flags like `LANGWATCH_DEV_HTTP2`.
// The API server (`server.mts`) loads its own copy via `dotenv.config()`
// the same way; doing it here keeps both processes reading from one
// source of truth.
dotenv.config({ path: path.resolve(__dirname, ".env") });

const FRONTEND_PORT = parseInt(process.env.PORT ?? "5560");
const API_PORT = FRONTEND_PORT + 1000;

// When `LANGWATCH_DEV_HTTP2=1` is set, Vite serves the SPA over
// HTTPS+HTTP/2 (matching the API server) and proxies `/api/*` upstream
// over HTTPS. Both sides share the same self-signed cert, cached at
// `<repo>/.dev-certs/`, so opting in is zero-setup and the browser only
// asks to trust the cert once for the whole local stack.
const USE_HTTP2 = process.env.LANGWATCH_DEV_HTTP2 === "1";
const API_PROTOCOL = USE_HTTP2 ? "https" : "http";

/**
 * Load (and lazily generate) the dev TLS credentials. Mirrors
 * `loadDevHttpsCredentials` in `src/start.ts`. Both processes race to
 * write on first boot; existence checks + atomic-ish file writes keep
 * the race benign — whichever loses the race overwrites with the same
 * effective contents, and subsequent reads find a valid pair.
 */
function loadDevHttpsCredentials():
  | { cert: Buffer; key: Buffer }
  | null {
  if (!USE_HTTP2) return null;

  if (process.env.DEV_HTTPS_CERT && process.env.DEV_HTTPS_KEY) {
    return {
      cert: readFileSync(process.env.DEV_HTTPS_CERT),
      key: readFileSync(process.env.DEV_HTTPS_KEY),
    };
  }

  const cacheDir =
    process.env.LANGWATCH_DEV_CERT_DIR ??
    path.join(__dirname, ".dev-certs");
  const certPath = path.join(cacheDir, "dev.pem");
  const keyPath = path.join(cacheDir, "dev-key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) {
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  }

  const pems = generateSelfsigned(
    [{ name: "commonName", value: "localhost" }],
    {
      days: 825,
      keySize: 2048,
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 2, value: "*.localhost" },
            { type: 7, ip: "127.0.0.1" },
            { type: 7, ip: "::1" },
          ],
        },
      ],
    },
  );
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(certPath, pems.cert);
  writeFileSync(keyPath, pems.private);
  return { cert: Buffer.from(pems.cert), key: Buffer.from(pems.private) };
}

const devHttpsCredentials = loadDevHttpsCredentials();

// Diagnostic: when Vite hot-restarts on a config change, the https block is
// re-evaluated but in-process TLS state can land in a broken pair (server
// listening, TLS handshake failing with `ERR_SSL_PROTOCOL_ERROR`). This log
// makes the post-restart scheme observable in `server.log`, so a "blank
// page after editing config" failure mode is easy to diagnose without
// digging into TLS errors. Drop in `pnpm dev:clean` to reset both the Vite
// module graph and `.dev-certs/` if the cert pair is suspected.
if (USE_HTTP2) {
  console.log(
    `[vite-config] HTTP/2 enabled; https credentials ${devHttpsCredentials ? "loaded" : "MISSING"}`,
  );
} else {
  console.log("[vite-config] HTTPS disabled (set LANGWATCH_DEV_HTTP2=1)");
}

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
    // HTTPS+HTTP/2 when LANGWATCH_DEV_HTTP2=1. Vite negotiates h2 over
    // TLS automatically when `https` is set. Both Vite and the API
    // share the same auto-generated cert so the browser only has to
    // trust one cert for the whole stack.
    ...(devHttpsCredentials
      ? {
          https: {
            cert: devHttpsCredentials.cert,
            key: devHttpsCredentials.key,
          },
        }
      : {}),
    // Proxy API requests to the Hono backend (PORT + 1000). `ws: true`
    // forwards WebSocket upgrades for the tRPC WS transport at /api/trpc-ws.
    proxy: {
      "/api": {
        target: `${API_PROTOCOL}://localhost:${API_PORT}`,
        changeOrigin: true,
        ws: true,
        // Self-signed dev cert — don't fail the proxy on cert verification.
        // No-op when API is on plain HTTP.
        secure: false,
      },
    },
  },
});
