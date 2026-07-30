import type { ClusteringPageOutcome } from "~/server/app-layer/topic-clustering/clustering";
import type {
  RequestedData,
  RunCompletedData,
  RunFailedData,
  RunStartedData,
} from "../schema";
import type { TopicClusteringRunIntentPayload } from "./schedule";

/**
 * What `topicClustering`'s `run` intent handler calls out to (ADR-102
 * decision 5's downward-dependency rule, and the same narrow-port shape
 * `triggerSettlement.dispatchPorts.ts` uses): the clustering algorithm
 * itself, and this pipeline's own aggregate commands for reporting the
 * outcome. Neither is an event-sourcing concern — clustering is
 * `app-layer/topic-clustering/clustering.ts`'s job, and turning an outcome
 * into a committed event is the (not yet built) command-dispatch layer's —
 * so this interface is the seam between them, adapted by the composition
 * root once one exists.
 *
 * **Argument shapes derive from declared payloads, never hand re-typed.**
 * `runClusteringPage`'s params are `Pick`-derived from the `run` intent's
 * own payload (`TopicClusteringRunIntentPayload`, `schedule.ts`); the three
 * outcome-reporting methods take this pipeline's own aggregate command
 * input types verbatim (`../schema.ts`) — each already declares its own
 * `occurredAt`, so there is nothing to add or re-type on top of them.
 */
export interface TopicClusteringDispatchPorts {
  /** Runs one clustering page. */
  runClusteringPage(
    params: Pick<
      TopicClusteringRunIntentPayload,
      "runId" | "page" | "searchAfter"
    > & {
      projectId: string;
    },
  ): Promise<ClusteringPageOutcome>;

  /** Reports that a page began working — best-effort; see
   * `dev/docs/adr/098-event-sourcing-core.md` decision 1's post-event-work
   * split (an outcome ANNOUNCEMENT is not itself stake-bearing the way the
   * page's own billed work is). */
  recordClusteringRunStarted(params: RunStartedData): Promise<void>;

  recordClusteringRunCompleted(params: RunCompletedData): Promise<void>;

  recordClusteringRunFailed(params: RunFailedData): Promise<void>;
}

/** Every field the `requested` event's data schema declares, minus the ones
 * a bootstrap seed supplies itself — re-exported here only so a future
 * bootstrap/seed caller has a `Pick`-derived shape to target instead of
 * hand-typing one. Not currently constructed by anything in this pipeline. */
export type TopicClusteringBootstrapRequest = Pick<RequestedData, "trigger">;
