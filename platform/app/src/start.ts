import promBundle from "express-prom-bundle";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createSecureServer } from "http2";
import path from "path";

/**
 * Auto-mints a self-signed cert pair for the local dev HTTPS+HTTP/2 server.
 * Cached at `<repo>/.dev-certs/` so the same cert is reused across boots —
 * means you only see the browser's "untrusted certificate" prompt once per
 * machine, then Chrome remembers it.
 *
 * Worktrees can share a single cert by setting `LANGWATCH_DEV_CERT_DIR`
 * to a stable path (otherwise each worktree mints + trusts its own).
 *
 * Override the auto-generated pair by setting `DEV_HTTPS_CERT` and
 * `DEV_HTTPS_KEY` to file paths — useful when teammates prefer mkcert
 * (which gets auto-trusted via the system root store, no prompts).
 */
async function loadDevHttpsCredentials(
  repoDir: string,
): Promise<{ cert: Buffer; key: Buffer }> {
  if (process.env.DEV_HTTPS_CERT && process.env.DEV_HTTPS_KEY) {
    return {
      cert: readFileSync(process.env.DEV_HTTPS_CERT),
      key: readFileSync(process.env.DEV_HTTPS_KEY),
    };
  }

  const cacheDir =
    process.env.LANGWATCH_DEV_CERT_DIR ?? path.join(repoDir, ".dev-certs");
  const certPath = path.join(cacheDir, "dev.pem");
  const keyPath = path.join(cacheDir, "dev-key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) {
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  }

  const { generate } = await import("selfsigned");
  // Apple's max accepted lifetime for trusted certs. selfsigned v5 dropped the
  // `days` option in favour of explicit not-before/not-after dates.
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825);
  const pems = await generate(
    [{ name: "commonName", value: "localhost" }],
    {
      notAfterDate,
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

import { createLogger } from "@langwatch/observability";
import { getRequestListener } from "@hono/node-server";
// Hono — unified API router
import type { Hono } from "hono";
import { register } from "prom-client";
import { createMcpHandler } from "./mcp/handler";
import { createApiRouter } from "./server/api-router";
import { getApp } from "./server/app-layer/app";
import {
  initializeInProcessApp,
  initializeWebApp,
} from "./server/app-layer/presets";
import { buildStorageConnectSrc } from "./server/buildStorageConnectSrc";
import {
  getWorkerMetricsPort,
  isMetricsAuthorized,
  normalizeMetricsPath,
} from "./server/metrics";
import { shutdownPostHog } from "./server/posthog";
import { verifyRedisReady } from "./server/redis";
import { serveStaticOrFallback } from "./server/static-handler";
import { setupTRPCWebSocket } from "./server/websockets/trpc-ws";
import { startWorkers, type WorkerHandle } from "./server/workers/startWorkers";

const logger = createLogger("langwatch:start");

export const metricsMiddleware = promBundle({
  metricsPath: "/metrics",
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  customLabels: { project_name: "langwatch" },
  bypass: {
    onRequest: (req) => {
      if (/^\/(api|assets|auth|settings|share|$)/.test(req.url ?? "")) {
        return false;
      }
      return true;
    },
    onFinish: () => false,
  },
  normalizePath: (req) => {
    if (req.url?.includes("/assets/")) return "/assets/*";
    return normalizeMetricsPath(req.url?.split("?")[0] ?? "/");
  },
});

export const startApp = async (dir = path.dirname(__dirname)) => {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = "0.0.0.0";

  // Dev-only single-process mode: host the background worker stack inside this
  // web process instead of a separate `pnpm run start:workers` process. Opt-in
  // via WORKERS_IN_PROCESS=1 (see scripts/start.sh + `pnpm dev:single`). Never
  // honoured in production — prod runs web and worker as separate deployments.
  //
  // Gate on NODE_ENV === "development" exactly (not `dev`, which is
  // `!== "production"`) so this matches scripts/start.sh's lane-skip predicate.
  // If they disagreed, an exotic NODE_ENV (e.g. "staging") would spawn BOTH the
  // standalone workers lane AND the in-process stack — duplicate consumers.
  const isInProcessWorkerModeEnabled =
    process.env.NODE_ENV === "development" &&
    (process.env.WORKERS_IN_PROCESS === "1" ||
      process.env.WORKERS_IN_PROCESS === "true");

  // Initialize the app-layer (services, repositories, event sourcing, etc.)
  // This was previously done by Next.js instrumentation hook. In-process mode
  // boots with the "all" role so the outbox consumer / drainer / heartbeat
  // scheduler wire up exactly as on a dedicated worker.
  if (isInProcessWorkerModeEnabled) {
    initializeInProcessApp();
  } else {
    initializeWebApp();
  }

  // Fail fast if Redis is unreachable — better-auth uses it as secondary
  // session store, and without it every request ends in a "Redirecting to
  // Sign in…" loop with no actionable error for the developer.
  await verifyRedisReady();

  // Partial-config assertion on LW_VIRTUAL_KEY_PEPPER /
  // LW_GATEWAY_INTERNAL_SECRET / LW_GATEWAY_JWT_SECRET now lives in
  // env-create.mjs so workers.ts, CLI scripts, and every other entry
  // point that imports env get it at import time (was server-only here).
  //
  // Server-only dev hint: the AI Gateway menu is on by default, so if no
  // gateway secrets are set at all the UI renders but
  // /api/internal/gateway/* returns 503. That's a `pnpm dev` onboarding
  // confusion, so the warning stays here.
  const gwSecretsUnset =
    !process.env.LW_VIRTUAL_KEY_PEPPER &&
    !process.env.LW_GATEWAY_INTERNAL_SECRET &&
    !process.env.LW_GATEWAY_JWT_SECRET;
  if (gwSecretsUnset) {
    logger.warn(
      "AI Gateway menu is on by default but no gateway secrets are set. " +
        "The UI will render but /api/internal/gateway/* will return 503. " +
        "See langwatch/.env.example for the required block.",
    );
  }

  // Dev: API server on PORT+1000 (default 6560).
  //      Vite dev server runs separately on PORT (default 5560) and proxies /api/* here.
  // Prod: Single server on PORT (default 5560) serves API routes + static files.
  const basePort = parseInt(process.env.PORT ?? "5560");
  // In portless (haven) mode the API binds an ephemeral loopback port that
  // Vite proxies `/api` to under the app origin (`app.<slug>.../api`);
  // otherwise PORT+1000.
  const port = process.env.LANGWATCH_API_PORT
    ? parseInt(process.env.LANGWATCH_API_PORT)
    : dev
      ? basePort + 1000
      : basePort;

  const mcpHandler = createMcpHandler();
  const honoApp = createApiRouter();
  // The Node→Hono bridge. `getRequestListener` streams request bodies through
  // (no buffering — the Langy ndjson relay depends on this) and streams the
  // response back. `overrideGlobalObjects: false`: never patch the process's
  // global Request/Response for the rest of the app.
  const apiListener = getRequestListener(honoFetchForNode(honoApp), {
    overrideGlobalObjects: false,
  });

  // In production, resolve the built client assets directory
  const clientDistDir = dev ? null : path.join(dir, "dist/client");

  // Security headers (migrated from next.config.mjs)
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev https://fonts.googleapis.com https://unpkg.com",
    "img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://*.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!dev ? ["upgrade-insecure-requests"] : []),
    "worker-src 'self' blob:",
    // ADR-032: allow the browser's presigned PUT to object storage (derived
    // from the same env the S3 client uses) — without it the CSP blocks the
    // upload before it leaves the page and the drawer silently falls back.
    `connect-src 'self' ${buildStorageConnectSrc({
      S3_ENDPOINT: process.env.S3_ENDPOINT,
      S3_REGION: process.env.S3_REGION,
      S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
      AWS_REGION: process.env.AWS_REGION,
      AZURE_BLOB_ENDPOINT: process.env.AZURE_BLOB_ENDPOINT,
    }).join(
      " ",
    )} https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://*.googletagmanager.com https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev`,
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://*.googletagmanager.com https://www.google.com https://*.reo.dev",
  ].join("; ");

  const securityHeaders: Record<string, string> = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    // CSP only in production — dev needs inline scripts for Vite HMR
    ...(!dev ? { "Content-Security-Policy": cspHeader } : {}),
    ...(!dev ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };

  // Optional HTTPS + HTTP/2 path for local dev. Set
  // `LANGWATCH_DEV_HTTP2=1` and a self-signed cert is auto-generated on
  // first boot (cached in `.dev-certs/` so subsequent boots reuse).
  // Browsers only negotiate h2 over TLS, so HTTPS is mandatory; first
  // visit shows a one-time untrusted-cert warning, then Chrome
  // remembers. `allowHTTP1: true` keeps non-h2 clients (curl,
  // older tools) working over the same port.
  //
  // Default off — `pnpm dev` keeps using plain HTTP/1.1 so nobody who
  // hasn't opted in sees a breaking change.
  const useHttp2 = dev && process.env.LANGWATCH_DEV_HTTP2 === "1";

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Collapse runs of slashes so paths like `//authorize` resolve to `/authorize`
      // instead of failing the absolute-path guard on the SPA fallback below.
      const pathname = ((req.url ?? "/").split("?")[0] ?? "/").replace(/\/{2,}/g, "/");

      // Apply security headers to all responses
      for (const [key, value] of Object.entries(securityHeaders)) {
        res.setHeader(key, value);
      }

      // MCP routes — intercept before everything
      if (mcpHandler.isMcpRoute(pathname)) {
        mcpHandler.handleRequest(req, res);
        return;
      }

      // Metrics endpoints
      if (pathname === "/metrics" || pathname === "/workers/metrics") {
        if (!isMetricsAuthorized(req)) {
          res.statusCode = 401;
          res.end("Unauthorized");
          return;
        }
        if (pathname === "/metrics" || isInProcessWorkerModeEnabled) {
          // /metrics, or /workers/metrics in single-process mode: the workers
          // share this process's prom-client registry (no separate listener),
          // so both paths serve the same registry.
          res.setHeader("Content-Type", register.contentType);
          res.end(await register.metrics());
        } else {
          // Forward the caller's bearer token — the worker's metrics
          // listener enforces the same isMetricsAuthorized gate, so a
          // credential-less internal fetch would get a 401 in production.
          const authorization = req.headers.authorization;
          const workersMetricsRes = await fetch(
            `http://0.0.0.0:${getWorkerMetricsPort()}/metrics`,
            authorization ? { headers: { authorization } } : undefined,
          );
          res.statusCode = workersMetricsRes.status;
          if (workersMetricsRes.ok) {
            res.setHeader("Content-Type", register.contentType);
          }
          res.end(await workersMetricsRes.text());
        }
        return;
      }

      // Apply metrics middleware
      await new Promise<void>((resolve) => {
        void metricsMiddleware(req as any, res as any, resolve as any);
      });

      // ---- API Routes (all go through Hono) ----
      if (pathname.startsWith("/api/")) {
        await apiListener(req, res);
        return;
      }

      // ---- Production: serve static assets + SPA fallback ----
      if (clientDistDir) {
        const handled = serveStaticOrFallback({ res, pathname, clientDistDir });
        if (handled) return;
      }

      res.statusCode = 404;
      res.end("Not Found");
    } catch (err) {
      logger.error({ url: req.url, error: err }, "error occurred handling request");
      res.statusCode = 500;
      res.end("internal server error");
    }
  };

  let server: ReturnType<typeof createServer> | ReturnType<typeof createSecureServer>;
  if (useHttp2) {
    const { cert, key } = await loadDevHttpsCredentials(dir);
    // Node's http2 compat-API hands us the same IncomingMessage /
    // ServerResponse shapes the http server uses, so the handler
    // body doesn't need to know which transport it's on.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    server = createSecureServer(
      { cert, key, allowHTTP1: true },
      handler as unknown as Parameters<typeof createSecureServer>[1],
    );
    logger.info("HTTP/2 + TLS enabled (LANGWATCH_DEV_HTTP2=1)");
  } else {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    server = createServer(handler);
  }

  // Bind the tRPC router to a WebSocket transport on the same HTTP server.
  // Lets high-frequency procedures (presence cursor today) escape the
  // browser's 6-connection HTTP cap by riding a single long-lived socket.
  const wsHandle = setupTRPCWebSocket(server as ReturnType<typeof createServer>);

  server.once("error", (err) => {
    logger.error({ error: err }, "error occurred on server");
    process.exit(1);
  });

  server.listen(port, () => {
    const asciiArt = `

██╗      █████╗ ███╗   ██╗ ██████╗ ██╗    ██╗ █████╗ ████████╗ ██████╗██╗  ██╗
██║     ██╔══██╗████╗  ██║██╔════╝ ██║    ██║██╔══██╗╚══██╔══╝██╔════╝██║  ██║
██║     ███████║██╔██╗ ██║██║  ███╗██║ █╗ ██║███████║   ██║   ██║     ███████║
██║     ██╔══██║██║╚██╗██║██║   ██║██║███╗██║██╔══██║   ██║   ██║     ██╔══██║
███████╗██║  ██║██║ ╚████║╚██████╔╝╚███╔███╔╝██║  ██║   ██║   ╚██████╗██║  ██║
╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝
`;
    // Print the banner via raw stdout instead of through pino — pino
    // would JSON-encode the multi-line art into a single escaped `msg`
    // string, which is unreadable when piped through prefixed log streams
    // (npx-server, docker logs with prefixes, etc.). Metadata still goes
    // through the structured logger for log aggregators downstream.
    process.stdout.write(asciiArt);
    logger.info(
      {
        hostname,
        port,
        fullUrl: `${useHttp2 ? "https" : "http"}://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`,
        mode: dev ? `development (API only — Vite on :${basePort})` : "production",
      },
      "langwatch listening",
    );
  });

  // Assigned by the in-process worker boot below. Declared here so the
  // shutdown handler can drain it, and so the boot can run *after* the signal
  // handlers are installed (a SIGTERM while workers are still booting hits
  // `workerHandle?.shutdown()` as a no-op — the process still exits cleanly,
  // it just doesn't wait for the still-booting workers to drain).
  let workerHandle: WorkerHandle | undefined;

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received signal, shutting down...");
    const forceExitTimer = setTimeout(() => {
      logger.warn("Graceful shutdown timed out after 5s, forcing exit");
      process.exit(1);
    }, 5_000);
    forceExitTimer.unref();
    // Politely tell WS clients to reconnect *before* tearing down the
    // socket — gives them tRPC's staggered reconnect path instead of a
    // hard TCP RST and a thundering herd on the next pod.
    try {
      wsHandle.broadcastReconnectNotification();
      await wsHandle.close();
    } catch (error) {
      logger.warn({ error }, "error while closing tRPC websocket server");
    }
    server.close();
    if ("closeAllConnections" in server) server.closeAllConnections();
    mcpHandler.closeAllSessions();
    // Drain in-process workers (if any) before closing the shared App below,
    // so jobs stop accepting/draining before ClickHouse / Redis / Prisma go away.
    try {
      await workerHandle?.shutdown();
    } catch (error) {
      logger.error({ error }, "error shutting down in-process workers");
    }
    try {
      await Promise.all([getApp().close(), shutdownPostHog()]);
    } catch (error) {
      logger.error({ error }, "Failed to close App");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ error: err }, "uncaught exception detected");
    server.close(() => process.exit(1));
    setTimeout(() => process.abort(), 1000).unref();
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.fatal(
      { reason: reason instanceof Error ? reason : { value: reason }, promise },
      "unhandled rejection detected"
    );
  });

  // In-process worker stack (dev opt-in via WORKERS_IN_PROCESS=1). Booted last —
  // after the server is listening AND the shutdown handlers are installed — so
  // the UI comes up even if the workers are slow to start. `workerHandle` isn't
  // assigned until this await resolves, so a SIGTERM during the boot still lets
  // the process exit cleanly; it just won't drain workers that are still
  // mid-boot. A boot failure is logged and the web server keeps running (only
  // the background jobs won't run).
  if (isInProcessWorkerModeEnabled) {
    logger.info("WORKERS_IN_PROCESS=1 — hosting the worker stack in-process");
    try {
      // shouldStartMetricsServer: false — in one process the worker prom
      // registry is this process's registry, already served at /metrics; no
      // second listener.
      workerHandle = await startWorkers({ shouldStartMetricsServer: false });
      logger.info("in-process workers ready");
    } catch (error) {
      logger.error(
        { error },
        "in-process workers failed to start — web server continues, background jobs will not run",
      );
    }
  }
};

/**
 * The Hono app's fetch, adjusted for the Node server entry. This is the ONLY
 * bridge logic we own — the Node↔fetch conversion itself is
 * `@hono/node-server`'s `getRequestListener`, which passes request bodies
 * through as live streams (`Readable.toWeb`) instead of buffering them. That
 * property is load-bearing: the Langy frame relay
 * (`POST /api/internal/langy/relay/frames`) is a long-lived ndjson connection
 * whose route reads line by line while the turn runs; the previous hand-rolled
 * bridge `await`ed the ENTIRE body before Hono ran, so every frame of a turn
 * arrived in one burst after the turn ended.
 *
 * Two response adjustments survive from the old bridge:
 *
 *  1. Hono's default not-found sentinel ("404 Not Found" text) becomes the
 *     uniform JSON 404 the /api surface has always returned. A route's own
 *     404 (different body) passes through untouched.
 *  2. langwatch#5219: a null-body response on a status that SHOULD carry a
 *     body must never reach the wire as 0 bytes — a tRPC client then throws
 *     `Unexpected end of JSON input` on `response.json()`. It becomes a
 *     parseable JSON error instead. 204/205/304 and HEAD legitimately carry
 *     no body and are left alone (a 304 revision-poll or 204 long-poll no-diff
 *     must stay empty).
 *
 * Exported for the langwatch#5219 + streaming-bridge regression tests.
 */
export function honoFetchForNode(
  honoApp: Pick<Hono, "fetch">,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await honoApp.fetch(request);

    if (response.status === 404) {
      const text = await response.clone().text();
      if (text === "404 Not Found") {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return response;
    }

    if (
      !response.body &&
      ![204, 205, 304].includes(response.status) &&
      request.method !== "HEAD"
    ) {
      const headers = new Headers(response.headers);
      if (!headers.get("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: "The server returned an empty response.",
        }),
        { status: response.status, headers },
      );
    }

    return response;
  };
}
