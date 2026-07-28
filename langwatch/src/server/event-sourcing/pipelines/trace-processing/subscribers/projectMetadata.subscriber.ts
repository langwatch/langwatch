import { createLogger } from "@langwatch/observability";

import type { ProjectService } from "~/server/app-layer/projects/project.service";

import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
// The subscriber spec shape, single-sourced with the other traceSummary
// subscribers rather than restated here.
import type { TraceSummarySubscriber } from "../reactors/_originGuardedSubscriber";

const logger = createLogger(
  "langwatch:trace-processing:project-metadata-subscriber",
);

/** Dedup window: one database round trip per project per minute of ingest. */
export const PROJECT_METADATA_DEBOUNCE_MS = 60_000;

export interface ProjectMetadataSubscriberDeps {
  projects: ProjectService;
}

/**
 * Sample traces (seeded from the empty-state "Seed sample traces" path; every
 * span carries `langwatch.origin = "sample"`) are not a real first ingest.
 * Flipping `firstMessage` / `integrated` on them would prematurely dismiss the
 * empty-state onboarding card even though the user hasn't connected their own
 * app yet. Skip entirely — a real trace will trigger this again.
 *
 * This reads fold state, so it cannot move to the enqueue seam: it stays in
 * the handler, where a sample trace costs one job that returns immediately.
 */
function isRealFirstIngest(state: TraceSummaryData): boolean {
  return state.attributes?.["langwatch.origin"] !== "sample";
}

/**
 * Marks the project as having received its first message.
 *
 * Sets project.firstMessage = true, project.integrated (unless
 * optimization_studio), and detects the SDK language from span resource
 * attributes.
 *
 * A subscriber rather than a process manager (ADR-075): nothing here is
 * deferred, so there is no deadline to make durable. The work is
 * level-triggered — the write re-asserts itself on the project's next trace,
 * so losing one is invisible by the following ingest. What the reactor called
 * a `ttl` is stated here as the debounce it always was.
 *
 * A side effect on Prisma, not derived state, which is why it is not a
 * projection: `integrated` is a latch read from the row it writes back
 * (an optimization-studio trace preserves whatever is already there), and the
 * Project row has its own lifecycle that no replay of the trace log owns.
 * Same call ADR-075 makes for `gatewayBudgetSync`'s `virtualKey.lastUsedAt`.
 *
 * **The ADR-051 clustering bootstrap used to live here** and now has its own
 * subscriber (`topicClusteringBootstrap.subscriber.ts`). It was never the same
 * concern: this is a one-time onboarding latch that stops writing once a
 * project is marked, that is a perpetual liveness re-assertion — and fused,
 * the bootstrap sat behind this handler's `projects.getById`, so a Prisma blip
 * silently skipped a clustering re-assertion.
 */
export function createProjectMetadataSubscriber(
  deps: ProjectMetadataSubscriberDeps,
): TraceSummarySubscriber {
  return {
    name: "projectMetadata",
    spec: {
      fold: "traceSummary",
      // Deliberately every event the fold handles, not just spans, matching
      // the reactor this replaces: any sign of life on a project can be the
      // one that first proves it is integrated, including a log-only trace.
      dedupId: (event) => event.tenantId,
      ttl: PROJECT_METADATA_DEBOUNCE_MS,
      handler: async (_event, context) => {
        const tenantId = context.tenantId;
        const attrs = context.state.attributes ?? {};

        if (!isRealFirstIngest(context.state)) return;

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

          const isOptimizationStudio =
            attrs["langwatch.platform"] === "optimization_studio";

          const sdkLanguage = attrs["sdk.language"];
          const language = isOptimizationStudio
            ? "other"
            : sdkLanguage === "python"
              ? "python"
              : sdkLanguage === "typescript"
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
    },
  };
}
