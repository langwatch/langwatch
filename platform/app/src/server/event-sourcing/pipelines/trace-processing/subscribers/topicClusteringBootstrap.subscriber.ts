import { createLogger } from "@langwatch/observability";

import type { ProjectService } from "~/server/app-layer/projects/project.service";

import type {
  EventSubscriberContext,
  EventSubscriberDefinition,
} from "../../../subscribers/eventSubscriber.types";
import type { TraceProcessingEvent } from "../schemas/events";
import {
  INGEST_SIGNAL_EVENT_TYPES,
  isSampleIngest,
  isSampleIngestEvent,
  PROJECT_INGEST_GROUP_KEY,
  readIngestSignals,
} from "./_ingestSignals";

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
 * Keeps every actively-ingesting project's topic clustering schedule alive
 * (ADR-051).
 *
 * **Split out of `projectMetadata` (ADR-075).** The two rode one handler
 * because ADR-051 bolted the bootstrap onto whatever already fired on every
 * ingest, not because they are one concern. They are not: the metadata write is
 * a one-time onboarding latch that stops writing once a project is marked, and
 * this is a perpetual liveness re-assertion. Fusing them put the bootstrap
 * *inside* the metadata write's `try`, behind its `projects.getById` — so a
 * Prisma blip skipped the clustering re-assertion entirely and logged it as
 * "Failed to update project metadata", leaving a clustering outage invisible
 * and mislabelled. Split, this reads the project for itself and fails *forward*
 * when that read fails, so a database blip can no longer cost a re-assertion.
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
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "topicClusteringBootstrap",
    eventTypes: INGEST_SIGNAL_EVENT_TYPES,
    options: {
      // Per project, so the per-project dedup below has something to collapse
      // into (see PROJECT_INGEST_GROUP_KEY).
      groupKeyFn: () => PROJECT_INGEST_GROUP_KEY,
      deduplication: {
        // Per project, not per trace — the whole minute of a project's ingest
        // collapses into one bootstrap job, and a busy project can never
        // starve another project's schedule. Distinct from the metadata
        // subscriber's key so the two never collapse into each other.
        makeId: (event) => `topic-clustering-bootstrap:${event.tenantId}`,
        ttlMs: TOPIC_CLUSTERING_BOOTSTRAP_DEBOUNCE_MS,
        // Pin the window to its first event and honour it past dispatch. The
        // default does neither: a key whose job has already dispatched is
        // treated as stale, so a project keeping up with its own ingest paid a
        // Prisma read and a bootstrap request per span — 59 of every 60 of
        // which could not act anyway, because the injected implementation's own
        // Redis claim runs for an hour.
        extend: false,
        shouldSurviveDispatch: true,
      },
      // The sample check, hoisted to the routing seam now that it reads three
      // single OTLP keys instead of normalizing the whole attribute set — a
      // total predicate, which is the bar the retry-less seam sets (ADR-069).
      // A project whose only traces are seeded samples now stages nothing,
      // which is the same answer the handler gave, one job earlier.
      enqueue: { filter: (event) => !isSampleIngestEvent(event) },
    },

    async handle(
      event: TraceProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      const tenantId = context.tenantId;

      // The reactor this replaces skipped sample traces wholesale, so a project
      // whose only traces are seeded samples has never been given a clustering
      // schedule — preserved rather than quietly widened, because widening it
      // would schedule daily clustering runs for every project that clicked
      // "seed sample traces" once.
      //
      // Re-asked rather than trusted: during a rolling deploy, jobs staged by a
      // build without the enqueue filter are still draining.
      if (isSampleIngest(readIngestSignals(event))) return;

      // Fail FORWARD on a read failure, and skip only on a definite answer.
      // The asymmetry is deliberate and matches the rate-limiter's own stance:
      // an unscheduled project is a silent product outage, while a redundant
      // bootstrap request is a no-op at the process. Only a successful read
      // saying the project is gone is worth skipping for.
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
        // Swallowed rather than rethrown, and the reason is specific: the rate
        // limiter takes its Redis claim BEFORE the request succeeds and does
        // not release it on failure, so a queue redelivery seconds later finds
        // the claim held and does nothing. Retry here is not durability, it is
        // a job that cannot possibly act. The real retry is this project's
        // next trace once the claim expires.
        logger.error(
          {
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Topic clustering bootstrap failed — re-asserted on this project's next trace after the claim window (non-fatal)",
        );
      }
    },
  };
}
