import express from "express";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import type IORedis from "ioredis";
import { basicAuth } from "./middleware/auth.ts";
import healthRouter from "./routes/health.ts";
import { createSSERouter } from "./routes/sse.ts";
import { createDashboardRouter } from "./routes/dashboard.ts";
import { createGroupsRouter } from "./routes/groups.ts";
import { createJobsRouter } from "./routes/jobs.ts";
import { createActionsRouter } from "./routes/actions.ts";
import { createBullMQRouter } from "./routes/bullmq.ts";
import type { SSEManager } from "./sse/sseManager.ts";
import type { MetricsCollector } from "./services/metricsCollector.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface AppDeps {
  redis: IORedis;
  sseManager: SSEManager;
  metrics: MetricsCollector;
  getGroupQueueNames: () => string[];
  getQueueNames: () => string[];
}

export function createApp({ redis, sseManager, metrics, getGroupQueueNames, getQueueNames }: AppDeps): express.Application {
  const app = express();

  app.use(express.json());

  // Health check — no auth
  app.use(healthRouter);

  // Auth (always applied; skipped only when SKYNET_SKIP_AUTH is explicitly set for local dev)
  if (process.env.SKYNET_SKIP_AUTH !== "1") {
    app.use(basicAuth);
  }

  const clientDir = path.resolve(__dirname, "../../dist/client");

  // API routes
  app.use(createSSERouter(sseManager, metrics));
  app.use(createDashboardRouter(metrics));
  app.use(createGroupsRouter(redis, metrics, getGroupQueueNames));
  app.use(createJobsRouter(redis, getGroupQueueNames));
  app.use(createActionsRouter(redis, getGroupQueueNames));
  app.use(createBullMQRouter(redis, getQueueNames));

  // Serve SPA static files (only when built assets exist, i.e. production)
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));

    // SPA fallback — only for navigation requests, not static assets
    app.get("/{*splat}", (req, res, next) => {
      if (path.extname(req.path)) {
        return next();
      }
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  return app;
}
