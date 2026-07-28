import { createLogger } from "@langwatch/observability";

import type { ProjectService } from "~/server/app-layer/projects/project.service";

import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
// The subscriber spec shape, single-sourced with the other traceSummary
// subscribers rather than restated here.
import type { TraceSummarySubscriber } from "../reactors/_originGuardedSubscriber";

const logger = createLogger(
  "langwatch:trace-processing:topic-clustering-bootstrap-subscriber",
);

/**
 * How often a project's ingest may mint a bootstrap job.
 *
 * This is a job-rate bound, not the healing cadence. The healing cadence is
 * the injected implementation's own Redis claim
 * (`BOOTSTRAP_CLAIM_TTL_SECONDS`, one hour), which is what keeps this to one
 * process-manager commit per project per window however many jobs reach it.
 */
export const TOPIC_CLUSTERING_BOOTSTRAP_DEBOUNCE_MS = 60_000;

export interface TopicClusteringBootstrapSubscriberDeps {
  /**
   * Read only to answer one question: does this project still exist? A
   * project deleted between ingest and handling must not be given a clustering
   * process that then wakes daily forever with nothing to cluster.
   */
  projects: ProjectService;
  /**
   * ADR-051: ensures the project's topic clustering process exists and has a
   * scheduled daily wake.
   *
   * Called on EVERY real ingest, not just the first — this is the
   * reconciliation path, so a project that somehow lost its schedule gets it
   * back on its next trace instead of waiting for an operator to run the
   * backfill. Safe to call repeatedly: a bootstrap-trigger request evolves an
   * already-bootstrapped process to the same state and cannot move its wake.
   * The injected implementation is rate-limited (see
   * createRateLimitedBootstrap), so this costs at most one commit per project
   * per claim window.
   */
  bootstrapTopicClustering: (projectId: string) => Promise<void>;
}

/**
 * Sample traces (seeded from the empty-state "Seed sample traces" path; every
 * span carries `langwatch.origin = "sample"`) are not real ingest. The reactor
 * this replaces skipped them wholesale, so a project whose only traces are
 * seeded samples has never been given a clustering schedule — preserved here
 * rather than quietly widened, because widening it would schedule daily
 * clustering runs for every project that clicked "seed sample traces" once.
 *
 * Reads fold state, so it cannot move to the enqueue seam: it stays in the
 * handler, where a sample trace costs one job that returns immediately.
 */
function isRealIngest(state: TraceSummaryData): boolean {
  return state.attributes?.["langwatch.origin"] !== "sample";
}

/**
 * Keeps every actively-ingesting project's topic clustering schedule alive
 * (ADR-051).
 *
 * **Split out of `projectMetadata` (ADR-075).** The two rode one handler
 * because ADR-051 bolted the bootstrap onto whatever already fired on every
 * ingest, not because they are one concern. They are not: the metadata write
 * is a one-time onboarding latch that stops writing once a project is marked,
 * and this is a perpetual liveness re-assertion. Fusing them meant the
 * bootstrap sat *inside* the metadata write's `try` block, behind its
 * `projects.getById` — so a Prisma blip skipped the clustering re-assertion
 * and logged it as a metadata failure. That coupling is what the split
 * removes.
 *
 * **A subscriber, not a process manager.** ADR-075 files this under Class E
 * (deferred re-check → process manager wake) alongside `originGate`. It is
 * not: there is no deferral here and no deadline to make durable. The durable
 * schedule this exists to protect already lives in the `topicClustering`
 * process manager, one pipeline over. A process manager whose only job is to
 * ensure another process manager exists would buy nothing but a row per trace.
 *
 * **Level-triggered, which is what makes at-most-once acceptable.** An edge
 * that is missed is missed forever, which is why ADR-051's original
 * first-message-transition bootstrap needed a deploy-time backfill to repair
 * it. Asking on every ingest instead means a lost invocation is re-asserted by
 * the project's next trace.
 */
export function createTopicClusteringBootstrapSubscriber(
  deps: TopicClusteringBootstrapSubscriberDeps,
): TraceSummarySubscriber {
  return {
    name: "topicClusteringBootstrap",
    spec: {
      fold: "traceSummary",
      // Deliberately every event the traceSummary fold handles, matching the
      // reactor this replaces. Narrowing to `span_received` would silently
      // drop log-only projects out of the reconciliation path, and buys
      // nothing — the dedup below already collapses a project's whole minute
      // of ingest into one job.
      dedupId: (event) => event.tenantId,
      ttl: TOPIC_CLUSTERING_BOOTSTRAP_DEBOUNCE_MS,
      handler: async (_event, context) => {
        const tenantId = context.tenantId;

        if (!isRealIngest(context.state)) return;

        // Fail FORWARD on a read failure, and skip only on a definite answer.
        // The asymmetry is deliberate and matches the rate-limiter's own
        // stance: an unscheduled project is a silent product outage, while a
        // redundant bootstrap request is a no-op at the process. Only a
        // successful read saying the project is gone is worth skipping for.
        let projectIsGone = false;
        try {
          projectIsGone = (await deps.projects.getById(tenantId)) === null;
        } catch (error) {
          logger.warn(
            {
              tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Could not confirm the project exists — re-asserting its clustering schedule anyway",
          );
        }
        if (projectIsGone) return;

        try {
          await deps.bootstrapTopicClustering(tenantId);
        } catch (error) {
          // Swallowed rather than rethrown, and the reason is specific: the
          // rate limiter takes its Redis claim BEFORE the request succeeds and
          // does not release it on failure, so a queue redelivery seconds
          // later finds the claim held and does nothing. Retry here is not
          // durability, it is a job that cannot possibly act. The real retry
          // is this project's next trace once the claim expires.
          logger.error(
            {
              tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Topic clustering bootstrap failed — re-asserted on this project's next trace after the claim window (non-fatal)",
          );
        }
      },
    },
  };
}
