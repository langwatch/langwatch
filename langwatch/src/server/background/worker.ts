import { type Job, type Worker } from "bullmq";
import type {
  CollectorJob,
  TopicClusteringJob,
  TraceCheckJob,
} from "~/server/background/types";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../trace_checks/evaluators.generated";
import { getDebugger } from "../../utils/logger";
import { startTopicClusteringWorker } from "./workers/topicClusteringWorker";
import {
  runEvaluationJob,
  startTraceChecksWorker,
} from "./workers/traceChecksWorker";
import { startTrackEventsWorker } from "./workers/trackEventsWorker";
import { startCollectorWorker } from "./workers/collectorWorker";

const debug = getDebugger("langwatch:workers");

export const start = (
  runEvaluationMock:
    | ((
        job: Job<TraceCheckJob, any, EvaluatorTypes>
      ) => Promise<SingleEvaluationResult>)
    | undefined = undefined,
  maxRuntimeMs: number | undefined = undefined
): Promise<
  | {
      collectorWorker: Worker<CollectorJob, void, string>;
      traceChecksWorker: Worker<TraceCheckJob, any, EvaluatorTypes>;
      topicClusteringWorker: Worker<TopicClusteringJob, void, string>;
      trackEventsWorker: Worker<TrackEventJob, void, string>;
    }
  | undefined
> => {
  return new Promise((resolve) => {
    const collectorWorker = startCollectorWorker();
    const traceChecksWorker = startTraceChecksWorker(
      runEvaluationMock ?? runEvaluationJob
    );
    const topicClusteringWorker = startTopicClusteringWorker();
    const trackEventsWorker = startTrackEventsWorker();

    if (maxRuntimeMs) {
      setTimeout(() => {
        debug("Max runtime reached, closing worker");
        void (async () => {
          await Promise.all([
            collectorWorker.close(),
            traceChecksWorker.close(),
            topicClusteringWorker.close(),
            trackEventsWorker.close(),
          ]);
          resolve(undefined);
        })();
      }, maxRuntimeMs);
    } else {
      resolve({
        collectorWorker,
        traceChecksWorker,
        topicClusteringWorker,
        trackEventsWorker,
      });
    }
  });
};
