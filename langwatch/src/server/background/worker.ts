import "../../instrumentation.node";
// This MUST BE first.

import type { Job, Worker } from "bullmq";
import type {
  CollectorJob,
  EvaluationJob,
  TopicClusteringJob,
  TrackEventJob,
  UsageStatsJob,
} from "~/server/background/types";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../server/evaluations/evaluators.generated";
import { createLogger } from "../../utils/logger/server";
import { startCollectorWorker } from "./workers/collectorWorker";
import {
  runEvaluationJob,
  startEvaluationsWorker,
} from "./workers/evaluationsWorker";
import { startTopicClusteringWorker } from "./workers/topicClusteringWorker";
import { startTrackEventsWorker } from "./workers/trackEventsWorker";

import fs from "fs";
import http from "http";
import path from "path";
import { register } from "prom-client";
import {
  type BullMQQueueState,
  setBullMQJobCount,
  workerRestartsCounter,
} from "../metrics";
import { getWorkerMetricsPort } from "./config";
import { WorkersRestart } from "./errors";

import { getApp } from "../app-layer/app";
import { getClickHouseClient } from "../clickhouse/client";
import {
  startStorageStatsCollection,
  stopStorageStatsCollection,
} from "../clickhouse/metrics";
import { connection as redis } from "../redis";
import { startScenarioProcessor } from "../scenarios/scenario.processor";
import type {
  ScenarioJob,
  ScenarioJobResult,
} from "../scenarios/scenario.queue";
import { monitoredQueues } from "./queues";
import { startUsageStatsWorker } from "./workers/usageStatsWorker";

const logger = createLogger("langwatch:workers");

type Closeable = { name: string; close: () => Promise<void> | void };
// Use Map to dedupe closeables by name - prevents accumulation across restarts
const closeables = new Map<string, Closeable>();
let isShuttingDown = false;

function registerCloseable(
  name: string,
  closeable: { close: () => Promise<void> | void } | undefined,
) {
  if (closeable) {
    closeables.set(name, { name, close: () => closeable.close() });
  }
}

export async function gracefulShutdown() {
  if (isShuttingDown) return; // Prevent multiple shutdown attempts
  isShuttingDown = true;

  logger.info({ count: closeables.size }, "Shutting down workers...");

  const results = await Promise.allSettled(
    [...closeables.values()].map(async (c) => {
      try {
        await c.close();
        logger.debug({ name: c.name }, "Closed");
      } catch (error) {
        logger.error({ name: c.name, error }, "Failed to close");
        throw error;
      }
    }),
  );

  const failed = results.filter((r) => r.status === "rejected").length;

  // Close App (ES pipelines + CH + Redis + Prisma)
  try {
    await getApp().close();
  } catch (error) {
    logger.error({ error }, "Failed to close App");
  }

  if (failed > 0) {
    logger.warn(
      { failed, total: closeables.size },
      "Shutdown completed with errors",
    );
  } else {
    logger.info("Shutdown complete");
  }

  process.exit(failed > 0 ? 1 : 0);
}

process.on("SIGINT", () => void gracefulShutdown());
process.on("SIGTERM", () => void gracefulShutdown());

type Workers = {
  collectorWorker: Worker<CollectorJob, void, string> | undefined;
  evaluationsWorker: Worker<EvaluationJob, any, EvaluatorTypes> | undefined;
  topicClusteringWorker: Worker<TopicClusteringJob, void, string> | undefined;
  trackEventsWorker: Worker<TrackEventJob, void, string> | undefined;
  usageStatsWorker: Worker<UsageStatsJob, void, string> | undefined;
  scenarioWorker: Worker<ScenarioJob, ScenarioJobResult, string> | undefined;
};

export const start = (
  runEvaluationMock:
    | ((
        job: Job<EvaluationJob, any, EvaluatorTypes>,
      ) => Promise<SingleEvaluationResult>)
    | undefined = undefined,
  maxRuntimeMs: number | undefined = undefined,
): Promise<Workers | undefined> => {
  // Reset state for restart scenarios - prevents duplicate closeables
  closeables.clear();
  isShuttingDown = false;

  // Start ClickHouse storage metrics collection if ClickHouse is enabled
  const clickHouseClient = getClickHouseClient();
  if (clickHouseClient) {
    startStorageStatsCollection(clickHouseClient);
  }

  return new Promise<Workers | undefined>((resolve, reject) => {
    const collectorWorker = startCollectorWorker();
    const evaluationsWorker = startEvaluationsWorker(
      runEvaluationMock ?? runEvaluationJob,
    );
    const topicClusteringWorker = startTopicClusteringWorker();
    const trackEventsWorker = startTrackEventsWorker();
    const usageStatsWorker = startUsageStatsWorker();
    const scenarioWorker = startScenarioProcessor();
    const metricsServer = startMetricsServer();

    // Register all closeables for graceful shutdown
    registerCloseable("collector", collectorWorker);
    registerCloseable("evaluations", evaluationsWorker);
    registerCloseable("topicClustering", topicClusteringWorker);
    registerCloseable("trackEvents", trackEventsWorker);
    registerCloseable("usageStats", usageStatsWorker);
    registerCloseable("scenario", scenarioWorker);
    registerCloseable("metricsServer", {
      close: () =>
        new Promise<void>((resolve) => metricsServer.close(() => resolve())),
    });
    registerCloseable("storageStats", {
      close: () => stopStorageStatsCollection(),
    });

    // Start BullMQ queue metrics collection
    startQueueMetrics();
    registerCloseable("queueMetrics", {
      close: () => stopQueueMetrics(),
    });

    incrementWorkerRestartCount();

    const closingListener = () => {
      if (isShuttingDown) return; // Don't restart during intentional shutdown
      logger.info("closed before expected, restarting");
      reject(new WorkersRestart("Worker closing before expected, restarting"));
    };

    collectorWorker?.on("closing", closingListener);
    evaluationsWorker?.on("closing", closingListener);
    topicClusteringWorker?.on("closing", closingListener);
    trackEventsWorker?.on("closing", closingListener);
    usageStatsWorker?.on("closing", closingListener);
    scenarioWorker?.on("closing", closingListener);

    if (maxRuntimeMs) {
      setTimeout(() => {
        logger.info("max runtime reached, closing worker");

        void (async () => {
          collectorWorker?.off("closing", closingListener);
          evaluationsWorker?.off("closing", closingListener);
          topicClusteringWorker?.off("closing", closingListener);
          trackEventsWorker?.off("closing", closingListener);
          usageStatsWorker?.off("closing", closingListener);
          scenarioWorker?.off("closing", closingListener);
          await Promise.all([
            collectorWorker?.close(),
            evaluationsWorker?.close(),
            topicClusteringWorker?.close(),
            trackEventsWorker?.close(),
            usageStatsWorker?.close(),
            scenarioWorker?.close(),
            new Promise<void>((resolve) =>
              metricsServer.close(() => resolve()),
            ),
          ]);

          setTimeout(() => {
            reject(
              new WorkersRestart("Max runtime reached, restarting worker"),
            );
          }, 0);
        })();
      }, maxRuntimeMs);
    } else {
      resolve({
        collectorWorker,
        evaluationsWorker,
        topicClusteringWorker,
        trackEventsWorker,
        usageStatsWorker,
        scenarioWorker,
      });
    }
  });
};

const incrementWorkerRestartCount = () => {
  try {
    const restartCountFile = path.join(
      "/tmp",
      "langwatch-worker-restart-count",
    );
    let restartCount = 0;
    if (fs.existsSync(restartCountFile)) {
      restartCount = parseInt(fs.readFileSync(restartCountFile, "utf8"));
    }
    restartCount++;
    fs.writeFileSync(restartCountFile, restartCount.toString());

    for (let i = 0; i < restartCount; i++) {
      workerRestartsCounter.inc();
    }
  } catch (error) {
    logger.error({ error }, "error incrementing worker restart count");
  }
};

// ============================================================================
// BullMQ Queue Metrics Collection
// ============================================================================

const QUEUE_METRICS_INTERVAL_MS = 15_000;
let queueMetricsInterval: ReturnType<typeof setInterval> | null = null;

async function collectQueueMetrics(): Promise<void> {
  const states: BullMQQueueState[] = [
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
    "paused",
    "prioritized",
    "waiting-children",
  ];

  await Promise.all(
    monitoredQueues.map(async ({ name, queue }) => {
      try {
        const counts = await queue.getJobCounts(...states);
        for (const state of states) {
          setBullMQJobCount(name, state, counts[state] ?? 0);
        }
      } catch (error) {
        logger.debug(
          {
            queueName: name,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to collect queue metrics",
        );
      }
    }),
  );
}

function startQueueMetrics(): void {
  stopQueueMetrics();
  if (!redis) return;
  void collectQueueMetrics();
  queueMetricsInterval = setInterval(() => {
    void collectQueueMetrics();
  }, QUEUE_METRICS_INTERVAL_MS);
}

function stopQueueMetrics(): void {
  if (queueMetricsInterval) {
    clearInterval(queueMetricsInterval);
    queueMetricsInterval = null;
  }
}

const startMetricsServer = (): http.Server => {
  const port = getWorkerMetricsPort();

  const server = http.createServer((req, res) => {
    if (req.url === "/metrics") {
      res.setHeader("Content-Type", register.contentType);
      try {
        register
          .metrics()
          .then((metrics) => {
            res.end(metrics);
          })
          .catch(() => {
            res.writeHead(500).end();
          });
      } catch (error) {
        logger.error({ error }, "error getting metrics");

        res.writeHead(500).end();
      }
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(port, () => {
    logger.info(`metrics server listening on port ${port}`);
  });

  return server;
};
