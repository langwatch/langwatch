import { createServer, type IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import path from "path";
import type { Duplex } from "stream";
import { register } from "prom-client";
import promBundle from "express-prom-bundle";
import { createLogger } from "./utils/logger";
import { initializeBackgroundWorkers } from "./server/background/init";

const logger = createLogger("langwatch:start");

// eslint-disable-next-line @typescript-eslint/no-var-requires
let studioSocket = require("../build-websocket/socketServer");

const reloadStudioSocket = () => {
  delete require.cache[require.resolve("../build-websocket/socketServer")];
  studioSocket = require("../build-websocket/socketServer");
  logger.info("reloaded studioSocket module");
};

if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const watch = require("watch");
  watch.createMonitor(
    path.join(__dirname, "../build-websocket"),
    { interval: 1 },
    function (monitor: any) {
      monitor.on("changed", function () {
        reloadStudioSocket();
      });
    }
  );
}

export const metricsMiddleware = promBundle({
  metricsPath: "/metrics",
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  includeUp: true,
  customLabels: { project_name: "langwatch" },
  bypass: {
    onRequest: (req) => {
      if (
        /^\/(api|_next|\[project\]|auth|settings|share|$)/.test(req.url ?? "")
      ) {
        return false;
      }
      return true;
    },
    onFinish: () => false,
  },
  normalizePath: (req) => {
    if (req.url?.includes("/_next/static")) {
      return "/_next/static";
    }
    // @ts-ignore
    const nextMeta = req[Symbol.for("NextInternalRequestMeta")];
    const nextJsPath = nextMeta?.match?.definition?.pathname;
    if (nextJsPath) {
      // Keep trpc request individual if they are not being lumped in together
      if (req.url?.includes("/trpc") && !req.url?.includes(",")) {
        return req.url.split("?")[0];
      }
      return nextJsPath;
    }
    return req.url;
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

module.exports.startApp = async (dir = path.dirname(__dirname)) => {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = "0.0.0.0";
  const port = parseInt(process.env.PORT ?? "5560");
  // when using middleware `hostname` and `port` must be provided below
  const app = next({
    dev,
    hostname,
    port,
    dir,
    turbo: !!dev && !process.env.USE_WEBPACK,
    turbopack: !!dev && !process.env.USE_WEBPACK,
  });
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = createServer(async (req, res) => {
    try {
      // Be sure to pass `true` as the second argument to `url.parse`.
      // This tells it to parse the query portion of the URL.
      const parsedUrl = parse(req.url ?? "", true);

      if (
        parsedUrl.pathname === "/metrics" ||
        parsedUrl.pathname === "/workers/metrics"
      ) {
        if (!isMetricsAuthorized(req)) {
          res.statusCode = 401;
          res.end("Unauthorized");
          return;
        }

        if (parsedUrl.pathname === "/metrics") {
          res.setHeader("Content-Type", register.contentType);
          res.end(await register.metrics());
        } else {
          const workersMetricsRes = await fetch("http://0.0.0.0:2999/metrics");
          const workersMetrics = await workersMetricsRes.text();
          res.setHeader("Content-Type", register.contentType);
          res.end(workersMetrics);
        }
      } else {
        // Apply metrics middleware
        await new Promise<void>((resolve) => {
          void metricsMiddleware(req as any, res as any, resolve as any);
        });

        // Handle the request with Next.js
        await handle(req, res, parsedUrl);
      }
    } catch (err) {
      logger.error(
        { url: req.url, error: err },
        "error occurred handling request"
      );
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const upgradeListener =
    (defaultHandler: (req: any, socket: any, head: Buffer) => any) =>
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const parsedUrl = parse(req.url ?? "", true);

      // Pass hot module reloading requests to Next.js
      if (parsedUrl.pathname === "/_next/webpack-hmr") {
        void defaultHandler(req, socket, head);
      } else if (parsedUrl.pathname?.startsWith("/api/studio/ws")) {
        void studioSocket.handleUpgrade(req, socket, head, parsedUrl);
      } else {
        socket.destroy();
      }
    };

  const initialHandler = upgradeListener(upgradeHandler);
  server.on("upgrade", initialHandler);

  // Workaround because apparently next.js calls .on("upgrade", ...) internally,
  // overwriting the initialHandler, we need to re - attach it while keeping hmr working
  const originalOn = server.on.bind(server);
  server.on = (event, handler) => {
    if (event === "upgrade") {
      server.off("upgrade", initialHandler);
      return originalOn(event, upgradeListener(handler));
    }
    return originalOn(event, handler);
  };

  server.once("error", (err) => {
    logger.error({ error: err }, "error occurred on server");
    process.exit(1);
  });

  server.listen(port, async () => {
    logger.info(
      { hostname, port, fullUrl: `http://${hostname}:${port}` },
      "LangWatch is ready 🎉"
    );

    // Initialize background workers
    try {
      await initializeBackgroundWorkers();
    } catch (error) {
      logger.error({ error }, "Failed to initialize background workers");
    }
  });

  // Global error handlers for uncaught exceptions and unhandled promise rejections
  process.on("uncaughtException", (err) => {
    logger.fatal({ error: err }, "uncaught exception detected");
    // shutdown the server gracefully
    server.close(() => {
      process.exit(1); // then exit
    });

    // If a graceful shutdown is not achieved after 1 second,
    // shut down the process completely
    setTimeout(() => {
      process.abort(); // exit immediately and generate a core dump file
    }, 1000).unref();
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.fatal(
      { reason: reason instanceof Error ? reason : { value: reason }, promise },
      "unhandled rejection detected"
    );
  });
};
