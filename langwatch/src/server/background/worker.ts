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
          resolve({
            collectorWorker,
            evaluationsWorker,
            topicClusteringWorker,
            trackEventsWorker,
          });
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
