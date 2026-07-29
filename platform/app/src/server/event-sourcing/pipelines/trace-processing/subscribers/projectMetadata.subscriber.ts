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
  "langwatch:trace-processing:project-metadata-subscriber",
);

/** Dedup window: one database round trip per project per minute of ingest. */
export const PROJECT_METADATA_DEBOUNCE_MS = 60_000;

export interface ProjectMetadataSubscriberDeps {
  projects: ProjectService;
}

/**
 * Marks the project as having received its first message.
 *
 * Sets project.firstMessage = true, project.integrated (unless
 * optimization_studio), and detects the SDK language from the ingesting
 * exporter's resource attributes.
 *
 * An **event subscriber** rather than a process manager (ADR-075): nothing here
 * is deferred, so there is no deadline to make durable. The work is
 * level-triggered — the write re-asserts itself on the project's next trace, so
 * losing one is invisible by the following ingest. What the reactor called a
 * `ttl` is stated here as the debounce it always was.
 *
 * A side effect on Prisma, not derived state, which is why it is not a
 * projection: `integrated` is a latch read from the row it writes back
 * (an optimization-studio trace preserves whatever is already there), and the
 * Project row has its own lifecycle that no replay of the trace log owns.
 *
 * **Event-carried state, not a projection read-back.** The reactor took its
 * three facts off `foldState.attributes`; a subscriber that read that fold back
 * would be racing the projection it is a sibling of. It does not need to — the
 * events carry the facts already, and `readIngestSignals` explains why one
 * event answers the same as the merged trace state (they are resource-scoped or
 * per-span-constant). No event schema had to change.
 *
 * **The ADR-051 clustering bootstrap used to live here** and now has its own
 * subscriber (`topicClusteringBootstrap.subscriber.ts`). It was never the same
 * concern: this is a one-time onboarding latch that stops writing once a
 * project is marked, that is a perpetual liveness re-assertion — and fused, the
 * bootstrap sat behind this handler's `projects.getById`, so a Prisma blip
 * silently skipped a clustering re-assertion and mislabelled it as a metadata
 * failure.
 */
export function createProjectMetadataSubscriber(
  deps: ProjectMetadataSubscriberDeps,
): EventSubscriberDefinition<TraceProcessingEvent> {
  return {
    name: "projectMetadata",
    eventTypes: INGEST_SIGNAL_EVENT_TYPES,
    options: {
      // Per project, so the per-project dedup below has something to collapse
      // into (see PROJECT_INGEST_GROUP_KEY).
      groupKeyFn: () => PROJECT_INGEST_GROUP_KEY,
      deduplication: {
        // Per project, not per trace: one database round trip per window
        // however many traces land in it. Distinct from the clustering
        // bootstrap's key so the two never collapse into each other.
        //
        // The event type is in the key because the two say different things: a
        // span carries the resource attributes the language is read from, and
        // an `origin_resolved` carries none. Collapsed together, an
        // origin_resolved that won the window would write `language: "other"`
        // over a Python project.
        makeId: (event) => `project-metadata:${event.tenantId}:${event.type}`,
        ttlMs: PROJECT_METADATA_DEBOUNCE_MS,
        // Pin the window to its first event and honour it past dispatch. The
        // default does neither: a key whose job has already dispatched is
        // treated as stale, so a project keeping up with its own ingest paid a
        // Prisma read per span and the window bought nothing.
        extend: false,
        shouldSurviveDispatch: true,
      },
      // The sample check, hoisted to the routing seam now that it reads three
      // single OTLP keys instead of normalizing the whole attribute set — a
      // total predicate, which is the bar the retry-less seam sets (ADR-069).
      // A project whose only traces are seeded samples now stages nothing.
      //
      // The onboarding latch CANNOT move here: "is this project already
      // marked?" lives in a Prisma row that no event carries, and the fold
      // state the reactor read is not available to an event subscriber. It
      // stays in the handler below.
      enqueue: { filter: (event) => !isSampleIngestEvent(event) },
    },

    async handle(
      event: TraceProcessingEvent,
      context: EventSubscriberContext,
    ): Promise<void> {
      const tenantId = context.tenantId;
      const signals = readIngestSignals(event);

      // Re-asked rather than trusted: during a rolling deploy, jobs staged by a
      // build without the enqueue filter are still draining.
      if (isSampleIngest(signals)) return;

      try {
        const project = await deps.projects.getById(tenantId);

        if (!project) {
          logger.warn(
            { tenantId },
            "Project not found — skipping metadata update",
          );
          return;
        }

        // Already marked — nothing to do
        if (project.firstMessage && project.integrated) {
          return;
        }

        const isOptimizationStudio = signals.platform === "optimization_studio";

        const language = isOptimizationStudio
          ? "other"
          : signals.sdkLanguage === "python"
            ? "python"
            : signals.sdkLanguage === "typescript"
              ? "typescript"
              : "other";

        await deps.projects.updateMetadata({
          id: tenantId,
          data: {
            firstMessage: true,
            integrated: isOptimizationStudio ? project.integrated : true,
            language,
          },
        });
      } catch (error) {
        logger.error(
          {
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to update project metadata — non-fatal",
        );
      }
    },
  };
}
