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
import { createLogger } from "../../utils/logger";
import { startCollectorWorker } from "./workers/collectorWorker";
import {
  runEvaluationJob,
  startEvaluationsWorker,
} from "./workers/evaluationsWorker";
import { startTopicClusteringWorker } from "./workers/topicClusteringWorker";
import { startTrackEventsWorker } from "./workers/trackEventsWorker";

import "../../instrumentation.node";
import fs from "fs";
import http from "http";
import path from "path";
import { register } from "prom-client";
import { workerRestartsCounter } from "../metrics";
import { WorkersRestart } from "./errors";
import type { EventSourcingJob } from "./types";

import { startEventSourcingWorker } from "./workers/eventSourcingWorker";
import { startUsageStatsWorker } from "./workers/usageStatsWorker";
import { getClickHouseClient } from "../clickhouse/client";
import { initializeEventSourcing } from "../event-sourcing";
import { connection as redis } from "../redis";

const logger = createLogger("langwatch:workers");

type Workers = {
  collectorWorker: Worker<CollectorJob, void, string> | undefined;
  evaluationsWorker: Worker<EvaluationJob, any, EvaluatorTypes> | undefined;
  topicClusteringWorker: Worker<TopicClusteringJob, void, string> | undefined;
  trackEventsWorker: Worker<TrackEventJob, void, string> | undefined;
  usageStatsWorker: Worker<UsageStatsJob, void, string> | undefined;
  eventSourcingWorker: Worker<EventSourcingJob, void, string> | undefined;
};

export const start = (
  runEvaluationMock:
    | ((
        job: Job<EvaluationJob, any, EvaluatorTypes>,
      ) => Promise<SingleEvaluationResult>)
    | undefined = undefined,
  maxRuntimeMs: number | undefined = undefined,
): Promise<Workers | undefined> => {
  // Initialize event sourcing with ClickHouse and Redis clients
  initializeEventSourcing({
    clickHouseClient: getClickHouseClient(),
    redisConnection: redis,
  });

  return new Promise<Workers | undefined>((resolve, reject) => {
    const collectorWorker = startCollectorWorker();
    const evaluationsWorker = startEvaluationsWorker(
      runEvaluationMock ?? runEvaluationJob,
    );
    const topicClusteringWorker = startTopicClusteringWorker();
    const trackEventsWorker = startTrackEventsWorker();
    const usageStatsWorker = startUsageStatsWorker();
    const eventSourcingWorker = startEventSourcingWorker();

    startMetricsServer();
    incrementWorkerRestartCount();

    const closingListener = () => {
      logger.info("closed before expected, restarting");
      reject(new WorkersRestart("Worker closing before expected, restarting"));
    };

    collectorWorker?.on("closing", closingListener);
    evaluationsWorker?.on("closing", closingListener);
    topicClusteringWorker?.on("closing", closingListener);
    trackEventsWorker?.on("closing", closingListener);
    usageStatsWorker?.on("closing", closingListener);
    eventSourcingWorker?.on("closing", closingListener);

    if (maxRuntimeMs) {
      setTimeout(() => {
        logger.info("max runtime reached, closing worker");

        void (async () => {
          collectorWorker?.off("closing", closingListener);
          evaluationsWorker?.off("closing", closingListener);
          topicClusteringWorker?.off("closing", closingListener);
          trackEventsWorker?.off("closing", closingListener);
          usageStatsWorker?.off("closing", closingListener);
          eventSourcingWorker?.off("closing", closingListener);
          await Promise.all([
            collectorWorker?.close(),
            evaluationsWorker?.close(),
            topicClusteringWorker?.close(),
            trackEventsWorker?.close(),
            usageStatsWorker?.close(),
            eventSourcingWorker?.close(),
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
        eventSourcingWorker,
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

const startMetricsServer = () => {
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

  server.listen(2999, () => {
    logger.info("metrics server listening on port 2999");
  });
};
