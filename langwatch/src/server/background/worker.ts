import { type Job, type Worker } from "bullmq";
import type {
  CollectorJob,
  TopicClusteringJob,
  TraceCheckJob,
  TrackEventJob,
} from "~/server/background/types";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../server/evaluations/evaluators.generated";
import { getDebugger } from "../../utils/logger";
import { startTopicClusteringWorker } from "./workers/topicClusteringWorker";
import {
  runEvaluationJob,
  startEvaluationsWorker,
} from "./workers/evaluationsWorker";
import { startTrackEventsWorker } from "./workers/trackEventsWorker";
import { startCollectorWorker } from "./workers/collectorWorker";

import * as Sentry from "@sentry/node";
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

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    beforeSend(event, hint) {
      if (
        hint.originalException instanceof WorkersRestart ||
        `${hint.originalException}`.includes("Max runtime reached")
      ) {
        return null;
      }
      return event;
    },
  });
}

const debug = getDebugger("langwatch:workers");

type Workers = {
  collectorWorker: Worker<CollectorJob, void, string> | undefined;
  evaluationsWorker: Worker<TraceCheckJob, any, EvaluatorTypes> | undefined;
  topicClusteringWorker: Worker<TopicClusteringJob, void, string> | undefined;
  trackEventsWorker: Worker<TrackEventJob, void, string> | undefined;
};

export const start = (
  runEvaluationMock:
    | ((
        job: Job<TraceCheckJob, any, EvaluatorTypes>
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
      debug("Worker closing before expected, restarting");
      reject(new WorkersRestart("Worker closing before expected, restarting"));
    };

    collectorWorker?.on("closing", closingListener);
    evaluationsWorker?.on("closing", closingListener);
    topicClusteringWorker?.on("closing", closingListener);
    trackEventsWorker?.on("closing", closingListener);

    if (maxRuntimeMs) {
      setTimeout(() => {
        debug("Max runtime reached, closing worker");

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
    debug("Error incrementing worker restart count", error);
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
          .catch((err) => {
            res.writeHead(500).end(err);
          });
      } catch (err) {
        res.writeHead(500).end(err);
      }
    } else {
      res.writeHead(404).end();
    }
  });

  server.listen(2999, () => {
    debug("Workers metrics server listening on port 2999");
  });
};
