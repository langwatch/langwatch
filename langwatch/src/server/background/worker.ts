import { type Job, type Worker } from "bullmq";
import type {
  CollectorJob,
  TopicClusteringJob,
  EvaluationJob,
  TrackEventJob,
} from "~/server/background/types";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../server/evaluations/evaluators.generated";
import { createLogger } from "../../utils/logger";
import { startTopicClusteringWorker } from "./workers/topicClusteringWorker";
import {
  runEvaluationJob,
  startEvaluationsWorker,
} from "./workers/evaluationsWorker";
import { startTrackEventsWorker } from "./workers/trackEventsWorker";
import { startCollectorWorker } from "./workers/collectorWorker";

import "../../instrumentation.node";
import http from "http";
import { register } from "prom-client";
import path from "path";
import fs from "fs";
import { workerRestartsCounter } from "../metrics";

class WorkersRestart extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkersRestart";
  }
}

const logger = createLogger("langwatch:workers");

type Workers = {
  collectorWorker: Worker<CollectorJob, void, string> | undefined;
  evaluationsWorker: Worker<EvaluationJob, any, EvaluatorTypes> | undefined;
  topicClusteringWorker: Worker<TopicClusteringJob, void, string> | undefined;
  trackEventsWorker: Worker<TrackEventJob, void, string> | undefined;
};

export const start = (
  runEvaluationMock:
    | ((
        job: Job<EvaluationJob, any, EvaluatorTypes>
      ) => Promise<SingleEvaluationResult>)
    | undefined = undefined,
  maxRuntimeMs: number | undefined = undefined
): Promise<Workers | undefined> => {
  return new Promise<Workers | undefined>((resolve, reject) => {
    const collectorWorker = startCollectorWorker();
    const evaluationsWorker = startEvaluationsWorker(
      runEvaluationMock ?? runEvaluationJob
    );
    const topicClusteringWorker = startTopicClusteringWorker();
    const trackEventsWorker = startTrackEventsWorker();

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

    if (maxRuntimeMs) {
      setTimeout(() => {
        logger.info("max runtime reached, closing worker");

        void (async () => {
          collectorWorker?.off("closing", closingListener);
          evaluationsWorker?.off("closing", closingListener);
          topicClusteringWorker?.off("closing", closingListener);
          trackEventsWorker?.off("closing", closingListener);

          await Promise.all([
            collectorWorker?.close(),
            evaluationsWorker?.close(),
            topicClusteringWorker?.close(),
            trackEventsWorker?.close(),
          ]);

          setTimeout(() => {
            reject(
              new WorkersRestart("Max runtime reached, restarting worker")
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
      });
    }
  });
};

const incrementWorkerRestartCount = () => {
  try {
    const restartCountFile = path.join(
      "/tmp",
      "langwatch-worker-restart-count"
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
      } catch (err) {
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
