import promBundle from "express-prom-bundle";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import fs from "fs";
import path from "path";
import { register } from "prom-client";
import { getApp } from "./server/app-layer/app";
import { initializeWebApp } from "./server/app-layer/presets";
import { getWorkerMetricsPort } from "./server/background/config";
import { createMcpHandler } from "./mcp/handler";
import { shutdownPostHog } from "./server/posthog";
import { createLogger } from "./utils/logger/server";

// Hono — unified API router
import type { Hono } from "hono";
import { createApiRouter } from "./server/api-router";

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
    return req.url?.split("?")[0] ?? req.url;
  },
});

const isMetricsAuthorized = (req: IncomingMessage): boolean => {
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === "production" && !process.env.METRICS_API_KEY) {
    throw new Error("METRICS_API_KEY is not set");
  }
  return (
    !process.env.METRICS_API_KEY ||
    authHeader === `Bearer ${process.env.METRICS_API_KEY}`
  );
};

export const startApp = async (dir = path.dirname(__dirname)) => {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = "0.0.0.0";

  // Initialize the app-layer (services, repositories, event sourcing, etc.)
  // This was previously done by Next.js instrumentation hook.
  initializeWebApp();

  // Dev: API server on PORT+1000 (default 6560).
  //      Vite dev server runs separately on PORT (default 5560) and proxies /api/* here.
  // Prod: Single server on PORT (default 5560) serves API routes + static files.
  const basePort = parseInt(process.env.PORT ?? "5560");
  const port = dev ? basePort + 1000 : basePort;

  const mcpHandler = createMcpHandler();
  const honoApp = createApiRouter();

  // In production, resolve the built client assets directory
  const clientDistDir = dev ? null : path.join(dir, "dist/client");

  // Security headers (migrated from next.config.mjs)
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.posthog.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.googletagmanager.com https://*.pendo.io https://client.crisp.chat https://static.hsappstatic.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.pendo.io https://client.crisp.chat https://*.google.com https://*.reo.dev https://fonts.googleapis.com",
    "img-src 'self' blob: data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://image.crisp.chat https://*.googletagmanager.com https://*.pendo.io https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "font-src 'self' data: https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://client.crisp.chat https://www.google.com https://*.reo.dev https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!dev ? ["upgrade-insecure-requests"] : []),
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.posthog.com https://*.pendo.io wss://*.pendo.io wss://client.relay.crisp.chat https://client.crisp.chat https://*.googletagmanager.com https://analytics.google.com https://stats.g.doubleclick.net https://*.google-analytics.com https://www.google.com https://*.reo.dev",
    "frame-src 'self' https://*.posthog.com https://*.pendo.io https://www.youtube.com https://get.langwatch.ai https://*.googletagmanager.com https://www.google.com https://*.reo.dev",
  ].join("; ");

  const securityHeaders: Record<string, string> = {
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    // CSP only in production — dev needs inline scripts for Vite HMR
    ...(!dev ? { "Content-Security-Policy": cspHeader } : {}),
    ...(!dev ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = createServer(async (req, res) => {
    try {
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";

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
        if (pathname === "/metrics") {
          res.setHeader("Content-Type", register.contentType);
          res.end(await register.metrics());
        } else {
          const workersMetricsRes = await fetch(
            `http://0.0.0.0:${getWorkerMetricsPort()}/metrics`
          );
          res.setHeader("Content-Type", register.contentType);
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
        const handled = await routeThroughHono(honoApp, req, res, hostname, port);
        if (handled) return;

        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Not Found" }));
        return;
      }

      // ---- Production: serve static assets + SPA fallback ----
      if (clientDistDir) {
        // Sanitize: reject any pathname containing traversal sequences before touching the filesystem
        const normalizedRelative = path.normalize(pathname.slice(1));
        if (normalizedRelative.startsWith("..") || path.isAbsolute(normalizedRelative)) {
          res.statusCode = 400;
          res.end("Bad Request");
          return;
        }
        const staticPath = path.join(clientDistDir, normalizedRelative);
        if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
          serveStaticFile(res, staticPath, pathname);
          return;
        }
        // SPA fallback — serve index.html for all non-API routes
        const indexHtml = path.join(clientDistDir, "index.html");
        if (fs.existsSync(indexHtml)) {
          res.setHeader("Content-Type", "text/html");
          fs.createReadStream(indexHtml).pipe(res);
          return;
        }
      }

      res.statusCode = 404;
      res.end("Not Found");
    } catch (err) {
      logger.error({ url: req.url, error: err }, "error occurred handling request");
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

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
    logger.info(
      {
        hostname,
        port,
        fullUrl: `http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`,
        mode: dev ? `development (API only — Vite on :${basePort})` : "production",
      },
      asciiArt
    );
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received signal, shutting down...");
    const forceExitTimer = setTimeout(() => {
      logger.warn("Graceful shutdown timed out after 5s, forcing exit");
      process.exit(1);
    }, 5_000);
    forceExitTimer.unref();
    server.close();
    server.closeAllConnections();
    mcpHandler.closeAllSessions();
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
};

async function routeThroughHono(
  honoApp: Hono,
  req: IncomingMessage,
  res: ServerResponse,
  hostname: string,
  port: number
): Promise<boolean> {
  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await readBody(req)
      : undefined;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const honoReq = new Request(`http://${hostname}:${port}${req.url}`, {
    method: req.method,
    headers,
    body: body as BodyInit | undefined,
    // @ts-ignore - duplex needed for streaming bodies
    duplex: "half",
  });

  const honoRes = await honoApp.fetch(honoReq);

  if (honoRes.status === 404) {
    const text = await honoRes.text();
    if (text === "404 Not Found") return false;
    res.statusCode = 404;
    honoRes.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(text);
    return true;
  }

  res.statusCode = honoRes.status;
  honoRes.headers.forEach((v, k) => res.setHeader(k, v));

  if (honoRes.body) {
    const reader = honoRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } else {
    res.end(await honoRes.text());
  }
  return true;
}

function serveStaticFile(res: ServerResponse, filePath: string, pathname: string) {
  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
  };
  res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
  if (pathname.startsWith("/assets/")) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
