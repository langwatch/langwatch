import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import path from "path";
import { defineConfig, type Plugin, type UserConfig } from "vite";
import { shikiManualChunk } from "@langwatch/design-system/shiki-chunking";
import { injectPublicAppConfigIntoHtml, type PublicAppConfig } from "./src/behavior/public-config";
// The resolver reads the server environment, so it deliberately lives on the
// projection module rather than being re-exported to browser code.
import { resolveUiPublicBootstrap } from "./src/behavior/public-config.projection";
import { UI_ASSET_URL_GLOBAL } from "./src/model/ui-asset-base";
import { havenHmrGate } from "./vite/havenHmrGate";
import { rootDiscoveryProxyPattern } from "./vite/root-discovery-proxy";

// This package declares `"type": "module"`, so Vite bundles the config as ESM
// and `__dirname` does not exist. `import.meta.dirname` is the same directory.
const here = import.meta.dirname;

// Load `.env` into the Vite config's process environment. Vite normally
// only exposes `VITE_*` vars to client code — but this config itself
// runs in Node and needs access to flags like `LANGWATCH_DEV_HTTP2`.
// The API process loads its own copy the same way; doing it here keeps both
// processes reading from one source of truth.
const rootEnvPath = path.resolve(here, "../../.env");
const rootOverlayPath = path.resolve(here, "../../.env.portless");

dotenv.config({ path: rootEnvPath, quiet: true });
// Portless (haven) overlay wins: loaded after .env with override so the
// resolved app port + api hostname take effect. Absent in non-portless runs.
dotenv.config({ path: rootOverlayPath, override: true, quiet: true });

const FRONTEND_PORT = parseInt(process.env.LANGWATCH_APP_PORT ?? process.env.PORT ?? "5560");
const API_PORT = FRONTEND_PORT + 1000;

// When `LANGWATCH_DEV_HTTP2=1` is set, Vite serves the SPA over
// HTTPS+HTTP/2 (matching the API server) and proxies `/api/*` upstream
// over HTTPS. Both sides share the same self-signed cert, cached at
// `<repo>/.dev-certs/`, so opting in is zero-setup and the browser only
// asks to trust the cert once for the whole local stack.
const USE_HTTP2 = process.env.LANGWATCH_DEV_HTTP2 === "1";
const API_PROTOCOL = USE_HTTP2 ? "https" : "http";
// In portless (haven) mode the app and its API are ONE origin
// (app.<slug>.langwatch.localhost): the SPA is served here and /api/* is proxied
// straight to the API backend on loopback. Proxying to loopback (not the app's
// own public hostname) avoids a self-proxy loop and needs no TLS/CA. Outside
// portless we keep the legacy PORT+1000 target (or an explicit LANGWATCH_API_URL).
const API_TARGET =
  process.env.LANGWATCH_PORTLESS === "1"
    ? `http://127.0.0.1:${process.env.LANGWATCH_API_PORT ?? API_PORT}`
    : (process.env.LANGWATCH_API_URL ?? `${API_PROTOCOL}://localhost:${API_PORT}`);

/**
 * The dev TLS credentials, when the developer supplies a pair.
 *
 * `platform/app` generated a pair here with `selfsigned` when none was
 * configured, so `LANGWATCH_DEV_HTTP2=1` was zero-setup. That import is gone,
 * and not as a simplification: `selfsigned` cannot be loaded in this workspace
 * at all. Two copies of `@peculiar/asn1-schema` are installed, so
 * `@peculiar/asn1-rsa` registers against one schema store and reads from the
 * other, and `import("selfsigned")` throws `Cannot get schema for
 * 'AlgorithmIdentifier'` before any code of ours runs. Importing it from a Vite
 * config therefore fails the config load outright — with HTTP/2 off as much as
 * on — which is why the old config could not be loaded either.
 *
 * `DEV_HTTPS_CERT` + `DEV_HTTPS_KEY` still work, and generation comes back with
 * one root `pnpm-workspace.yaml` override that collapses the duplicate.
 */
function loadDevHttpsCredentials(): { cert: Buffer; key: Buffer } | null {
  if (!USE_HTTP2) return null;

  if (process.env.DEV_HTTPS_CERT && process.env.DEV_HTTPS_KEY) {
    return {
      cert: readFileSync(process.env.DEV_HTTPS_CERT),
      key: readFileSync(process.env.DEV_HTTPS_KEY),
    };
  }

  console.warn(
    "[vite-config] LANGWATCH_DEV_HTTP2=1 but no DEV_HTTPS_CERT/DEV_HTTPS_KEY pair; serving over plain HTTP.",
  );
  return null;
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
  const noopPath = path.resolve(here, "./vite/noop-module.cjs");
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

/**
 * Production receives public configuration from the process that serves the
 * HTML shell. In development Vite owns the shell, so it performs the same
 * explicit boot mapping during its own executable config phase.
 */
function injectDevelopmentPublicConfig(config: PublicAppConfig): Plugin {
  return {
    name: "inject-development-public-config",
    apply: "serve",
    transformIndexHtml(html) {
      return injectPublicAppConfigIntoHtml({ html, config });
    },
  };
}

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  const devHttpsCredentials = loadDevHttpsCredentials();
  const publicConfig =
    command === "serve" ? resolveUiPublicBootstrap(process.env).publicConfig : undefined;

  // Diagnostic: when Vite hot-restarts on a config change, the https block is
  // re-evaluated but in-process TLS state can land in a broken pair (server
  // listening, TLS handshake failing with `ERR_SSL_PROTOCOL_ERROR`). This log
  // makes the post-restart scheme observable in `server.log`, so a "blank page
  // after editing config" failure mode is easy to diagnose without digging into
  // TLS errors.
  if (command === "serve") {
    if (USE_HTTP2) {
      console.log(
        `[vite-config] HTTP/2 enabled; https credentials ${devHttpsCredentials ? "loaded" : "MISSING"}`,
      );
    } else {
      console.log("[vite-config] HTTPS disabled (set LANGWATCH_DEV_HTTP2=1)");
    }
  }

  return {
    plugins: [
      react(),
      patchObjectInspectBrowserStub(),
      ...(publicConfig ? [injectDevelopmentPublicConfig(publicConfig)] : []),
      havenHmrGate(),
    ],
    resolve: {
      // ONE zod instance for the app AND linked workspace packages
      // (@langwatch/langy): zod v3 instanceof-checks its own classes (e.g.
      // z.record's key/value overload detection), so a second physical copy
      // resolved from a package's own node_modules silently mis-parses.
      dedupe: ["zod"],
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
    optimizeDeps: {
      // DEV-ONLY: optimizeDeps never touches the production build (prod bundles
      // Shiki via the manualChunks rule below). Pre-bundle the whole Shiki
      // ecosystem at dev-server start so the server doesn't discover Shiki's
      // Oniguruma WASM engine + langs/themes lazily on the first /traces
      // navigation and re-optimize mid-session. That re-optimization invalidates
      // the in-flight `.vite/deps/wasm-*.js` (onig.wasm, ~620KB) request the span
      // highlighter awaits, leaving the trace drawer stuck on "loading spans".
      include: [
        "shiki",
        "@shikijs/core",
        "@shikijs/engine-oniguruma",
        "@shikijs/langs",
        "@shikijs/themes",
      ],
    },
    build: {
      outDir: "dist/client",
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // Shiki chunk-splitting lives in the Design System's
            // `shiki-chunking` module (dependency-free) so its guard test can
            // exercise the real logic. It keeps the core + base grammars/themes
            // eager and splits the other ~340 grammars into lazy chunks —
            // removing the ~9.5 MB raw / 1.66 MB gzip eager Shiki chunk that
            // used to load on every page. See that file for the boot-cycle
            // rationale.
            return shikiManualChunk(id);
          },
        },
      },
    },
    experimental: {
      // ADR-086: the base for content-hashed assets is chosen at container start,
      // not build time — one image serves self-host same-origin and SaaS from a
      // commit-prefixed CDN. Emit every JS-referenced asset URL as a call to the
      // runtime resolver defined by the served HTML shell
      // (src/model/ui-asset-base.ts); keep CSS-referenced assets relative to the
      // CSS file (which lives under the same base, so fonts/images resolve on the
      // CDN); leave HTML entry refs base-absolute for the server to rewrite;
      // leave public/ assets same-origin.
      renderBuiltUrl(filename, { type, hostType }) {
        if (type === "public") return undefined;
        if (hostType === "js") {
          // Self-defaulting so the built bundle is usable even when the server
          // hasn't injected the resolver: `vite preview`, the boot-smoke, and any
          // raw-`dist/` static server fall back to same-origin ("/"+path). Read
          // via `globalThis` (defined in the main document AND in Web Worker
          // scopes, where `window` is undefined) so a worker chunk degrades to
          // same-origin instead of throwing. The server sets
          // `globalThis.__lwAssetUrl` to the CDN prefixer when LANGWATCH_ASSET_BASE
          // is configured.
          return {
            runtime: `(globalThis.${UI_ASSET_URL_GLOBAL}||function(p){return "/"+p})(${JSON.stringify(
              filename,
            )})`,
          };
        }
        if (hostType === "css") return { relative: true };
        return undefined;
      },
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
          // Any dev-server tee target (server.log, server-qa.log, ...): the
          // server appends on every request, so watching one turns each page
          // load into a full-reload loop.
          "**/server*.log",
          // Working files agents keep under .claude/tmp, per the repo
          // convention. A dev-server log teed there reloads the page on every
          // request, same trap as above under a different name. Agent
          // worktrees also live under .claude/worktrees, and chokidar
          // matches ignore globs against full paths, so from a worktree
          // root any pattern containing .claude/worktrees matches every
          // file in the tree and blinds the watcher entirely. From a
          // worktree only .claude/tmp is ignored (worktrees do not nest);
          // from the main root the entire .claude tree, nested worktree
          // copies included, stays ignored as before.
          ...(process.cwd().includes("/.claude/") ? ["**/.claude/tmp/**"] : ["**/.claude/**"]),
        ],
        // Docker-on-macOS bind mounts don't surface inotify events reliably,
        // so Vite's default fs.watch sits silent on edits made from the host.
        // Polling at 250ms is the standard workaround and HMR fires
        // immediately. Native macOS / Linux hosts opt out via
        // `LANGWATCH_VITE_NO_POLLING=1` to dodge the CPU tax.
        ...(process.env.LANGWATCH_VITE_NO_POLLING === "1"
          ? {}
          : { usePolling: true, interval: 250 }),
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
      //
      // The MCP routes (/mcp, /sse, /messages, /oauth/*, /.well-known/oauth-*)
      // are registered directly on the API process's Node HTTP server (NOT
      // mounted under /api), so they need explicit proxy entries here for
      // external MCP clients (e.g. Claude Code adding the LangWatch MCP
      // server in dev) to reach them via the canonical FRONTEND_PORT. The
      // production server listens on a single port so this splitting is
      // dev-only.
      proxy: {
        // The tRPC WS transport enforces a same-origin allowlist (built from
        // NEXTAUTH_URL) and fail-closes on a missing/mismatched Origin. The
        // catch-all `/api` proxy below sets `changeOrigin: true`, which rewrites
        // the WS handshake Origin so the backend sees a null/foreign origin and
        // rejects every upgrade — silently breaking all WS-backed workbench
        // state. A dedicated, earlier entry keeps the browser's real Origin.
        "/api/trpc-ws": {
          target: API_TARGET,
          changeOrigin: false,
          ws: true,
          secure: false,
        },
        "/api": {
          target: API_TARGET,
          changeOrigin: true,
          ws: true,
          // Self-signed dev cert — don't fail the proxy on cert verification.
          // No-op when API is on plain HTTP.
          secure: false,
        },
        // An exporter given the site root as its OTLP endpoint posts to
        // `/v1/traces`. In production the API process routes those; in dev
        // the frontend owns the root, so they need an entry of their own or they
        // fall through to the SPA. Exact-match, same reasoning as /mcp below.
        "^/v1/(?:traces|logs|metrics)/?(?:\\?.*)?$": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        // Root-level API discovery — `/.well-known/openapi` and `/llms.txt`.
        // Same split as the OTLP paths above: the API process routes them in
        // production, the frontend owns the root in development. Left out, they
        // fall to the SPA, which answers an agent's discovery request with the
        // HTML shell and a 200.
        [rootDiscoveryProxyPattern()]: {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        // Exact-match only ("^...$") — a plain "/mcp" prefix also swallows the
        // /mcp/authorize frontend page route, sending it to the API server,
        // which has no dev-mode page fallback. server.proxy regexes test against
        // the full req.url (path + query), so the optional "(?:\?.*)?" is
        // required or a query-bearing request like "/mcp?sessionId=..." falls
        // through to the frontend instead.
        "^/mcp(?:\\?.*)?$": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        "^/mcp/health(?:\\?.*)?$": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        "/sse": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        "/messages": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        "/oauth": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        "/.well-known/oauth-protected-resource": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        "/.well-known/oauth-authorization-server": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        // Probed by MCP clients during discovery. The API answers a JSON 404;
        // without this entry dev would answer the SPA's HTML instead, which is
        // the failure mode this route exists to avoid.
        "/.well-known/openid-configuration": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
