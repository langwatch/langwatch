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
      if (hint.originalException instanceof WorkersRestart) {
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
  return new Promise<Workers | undefined>((resolve) => {
    const collectorWorker = startCollectorWorker();
    const evaluationsWorker = startEvaluationsWorker(
      runEvaluationMock ?? runEvaluationJob
    );
    const topicClusteringWorker = startTopicClusteringWorker();
    const trackEventsWorker = startTrackEventsWorker();

    startMetricsServer();

    if (maxRuntimeMs) {
      setTimeout(() => {
        debug("Max runtime reached, closing worker");

        void (async () => {
          await Promise.all([
            collectorWorker?.close(),
            evaluationsWorker?.close(),
            topicClusteringWorker?.close(),
            trackEventsWorker?.close(),
          ]);

          setTimeout(() => {
            throw new WorkersRestart("Max runtime reached, restarting worker");
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
