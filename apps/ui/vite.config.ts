import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";

import {
  injectPublicAppConfigIntoHtml,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";
// The resolver reads the server environment, so it deliberately lives on the
// projection module rather than being re-exported to browser code.
import { resolveUiPublicBootstrap } from "@langwatch/config/public-app-config/projection";
import { shikiManualChunk } from "@langwatch/design-system/shiki-chunking";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import { defineConfig, type Plugin, type UserConfig } from "vite";

import { UI_ASSET_URL_GLOBAL } from "./vite/asset-base";
import { designSystemStorybook } from "./vite/design-system-storybook";
import { createDevLogger } from "./vite/dev-logging";
import { havenHmrGate } from "./vite/havenHmrGate";
import { rootDiscoveryProxyPattern } from "./vite/root-discovery-proxy";
import { SHIKI_PREBUNDLE_INCLUDE } from "./vite/shiki-prebundle";

// This package declares `"type": "module"`, so Vite bundles the config as ESM
// and `__dirname` does not exist. `import.meta.dirname` is the same directory.
const here = import.meta.dirname;
const repoRoot = path.resolve(here, "../..");

type PackageExportTarget = string | { default?: string };

/** Every immediate directory of `base` (one level, e.g. `packages/*`). */
function childDirectories(base: string): string[] {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name));
}

/** One entry per real subpath a package's own exports map declares. */
function sourceEntriesForPackage(dir: string): { specifier: string; target: string }[] {
  const packageJsonPath = path.join(dir, "package.json");
  if (!existsSync(packageJsonPath)) return [];

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    name?: string;
    exports?: Record<string, PackageExportTarget>;
  };
  if (!pkg.name?.startsWith("@langwatch/") || !pkg.exports) return [];

  const entries: { specifier: string; target: string }[] = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath.includes("*") || subpath === "./package.json") continue;
    const relativeTarget = typeof target === "string" ? target : target.default;
    if (!relativeTarget) continue;

    const specifier = subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
    entries.push({ specifier, target: path.resolve(dir, relativeTarget) });
  }
  return entries;
}

/**
 * Dev only: every `@langwatch/*` workspace package resolves from source, so
 * declaring a dependency is enough. A plugin, not `resolve.alias` — see below.
 */
function workspaceSourcePlugin(): Plugin {
  // Lazy on purpose. Vite restarts the dev server when its resolved CONFIG
  // hash moves, so an alias list derived from exports maps made every new
  // export a restart plus a full dependency re-optimize — measured at four
  // restarts in eight minutes during a fan-out. A plugin reads the same maps
  // on demand and the config never moves.
  let sources: Map<string, string> | undefined;

  const build = (): Map<string, string> => {
    const found = new Map<string, string>();
    const packageDirs = [
      ...childDirectories(path.join(repoRoot, "packages")),
      ...childDirectories(path.join(repoRoot, "modules")).flatMap(childDirectories),
      ...childDirectories(path.join(repoRoot, "enterprise", "modules")).flatMap(childDirectories),
    ];
    for (const dir of packageDirs) {
      for (const { specifier, target } of sourceEntriesForPackage(dir))
        found.set(specifier, target);
    }
    return found;
  };

  return {
    name: "langwatch:workspace-source",
    apply: "serve",
    resolveId(source) {
      if (!source.startsWith("@langwatch/")) return null;
      sources ??= build();
      return sources.get(source) ?? null;
    },
    watchChange(id) {
      // A new export or dependency invalidates the map — and nothing else.
      if (id.endsWith("package.json")) sources = void 0;
    },
  };
}

// Load .env for Vite config (matches API config source); dotenv won't override haven's vars.
const rootEnvPath = path.resolve(here, "../../.env");

dotenv.config({ path: rootEnvPath, quiet: true });

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

// object-inspect's index.js does `var inspectCustom = require('./util.inspect')` and
// the package.json sets `"browser": { "./util.inspect.js": false }`.
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

// One shape for every lane in a `pnpm dev` terminal, and the place the
// proxy's failures are collapsed to one line - see ./vite/dev-logging. Built
// once at module scope so the two startup diagnostics below can write
// through it too, rather than through a bare `console.log` that arrives
// under haven with none of the shared shape.
const devLogger = createDevLogger({ proxyTarget: API_TARGET });

function logDevelopmentTlsState(
  command: string,
  devHttpsCredentials: { cert: Buffer; key: Buffer } | null,
): void {
  if (command !== "serve") return;
  if (USE_HTTP2) {
    devLogger.info(
      `[vite-config] HTTP/2 enabled; https credentials ${devHttpsCredentials ? "loaded" : "MISSING"}`,
    );
    return;
  }
  devLogger.info("[vite-config] HTTPS disabled (set LANGWATCH_DEV_HTTP2=1)");
}

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  const devHttpsCredentials = loadDevHttpsCredentials();
  // The dev server is its own public address. `dev-stack.sh` aligns BASE_HOST
  // to PORT for the whole stack; a lone `pnpm dev:ui` with no `.env` gets the
  // same answer here instead of a boot refusal naming an env var.
  const publicConfig =
    command === "serve"
      ? resolveUiPublicBootstrap({
          ...process.env,
          BASE_HOST: process.env.BASE_HOST ?? `http://localhost:${FRONTEND_PORT}`,
        }).publicConfig
      : undefined;

  // Diagnostic: when Vite hot-restarts on a config change, the https block is
  // re-evaluated but in-process TLS state can land in a broken pair (server listening,
  // TLS handshake failing with `ERR_SSL_PROTOCOL_ERROR`).
  logDevelopmentTlsState(command, devHttpsCredentials);

  return {
    // One shape for every lane in a `pnpm dev` terminal, and the place the
    // proxy's failures are collapsed to one line — see ./vite/dev-logging.
    customLogger: devLogger,
    plugins: [
      react(),
      patchObjectInspectBrowserStub(),
      ...(publicConfig ? [injectDevelopmentPublicConfig(publicConfig)] : []),
      havenHmrGate(),
      designSystemStorybook({ appPort: FRONTEND_PORT }),
      workspaceSourcePlugin(),
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
      // The list, and the reason each entry is named through its owner, live in
      // ./vite/shiki-prebundle so one value is what the config and its guard
      // both read.
      include: [...SHIKI_PREBUNDLE_INCLUDE],
    },
    build: {
      outDir: "dist/client",
      sourcemap: true,
      rollupOptions: {
        // Both statically and dynamically imported means the `import()` splits
        // nothing -- the module stays in the importer's chunk. Rolldown always
        // detected this and we only logged it, which is how 468 kB of screens
        // ended up eager across 22 modules.
        onwarn(warning, defaultHandler) {
          if (warning.code === "INEFFECTIVE_DYNAMIC_IMPORT") {
            throw new Error(
              `${warning.message}\nMove the value the entry imports statically out of the screen — into the module's model/*-host.ts, which the entry already re-exports — so the screen is reached only through its loader.`,
            );
          }
          defaultHandler(warning);
        },
        output: {
          manualChunks(id: string) {
            // Shiki chunk-splitting lives in the Design System's `shiki-chunking`
            // module (dependency-free) so its guard test can exercise the real logic.
            return shikiManualChunk(id);
          },
        },
      },
    },
    experimental: {
      // ADR-086: the base for content-hashed assets is chosen at container start, not
      // build time. JS-referenced assets call the runtime resolver
      // (vite/asset-base.ts); CSS-referenced assets stay relative to the CSS
      // file; HTML entry refs stay base-absolute for the server to rewrite; public/
      // assets stay same-origin.
      renderBuiltUrl(filename, { type, hostType }) {
        if (type === "public") return undefined;
        if (hostType === "js") {
          // Self-defaulting so the built bundle is usable even when the server hasn't
          // injected the resolver: `vite preview`, the boot-smoke, and any raw-`dist/`
          // static server fall back to same-origin ("/"+path).
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
          // Working files agents keep under .claude/tmp, per the repo convention. A
          // dev-server log teed there reloads the page on every request, same trap as
          // above under a different name.
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
      // Proxy API requests to the Hono backend (PORT + 1000). `ws: true` forwards
      // WebSocket upgrades for the tRPC WS transport at /api/trpc-ws.
      proxy: {
        // The tRPC WS transport enforces a same-origin allowlist (built from
        // NEXTAUTH_URL) and fail-closes on a missing/mismatched Origin.
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
        // The API process serves the sandboxed chart frame in production; in
        // dev the frontend owns the root, so it needs its own entry or it
        // falls through to the SPA and every widget frame renders blank.
        "^/sandbox/chart-frame(?:\\?.*)?$": {
          target: API_TARGET,
          changeOrigin: true,
          secure: false,
        },
        // Exact /mcp match (not prefix) to avoid swallowing /mcp/authorize; include query handling.
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
