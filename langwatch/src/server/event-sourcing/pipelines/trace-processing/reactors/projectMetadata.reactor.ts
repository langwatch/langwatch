import { createLogger } from "@langwatch/observability";
import type { ProjectServicePort } from "~/server/domain/projects/project-service.port";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:project-metadata-reactor",
);

export interface ProjectMetadataReactorDeps {
  projects: ProjectServicePort;
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
  bootstrapTopicClustering?: (projectId: string) => Promise<void>;
}

/**
 * Reactor that marks the project as having received its first message.
 *
 * Sets project.firstMessage = true, project.integrated (unless optimization_studio),
 * and detects the SDK language from span resource attributes.
 *
 * Uses a long dedup TTL so we only hit the database once per project in a given window.
 */
/**
 * Pure relevance guard, shared by shouldReact (pre-enqueue) and handle
 * (fail-open path). Sample traces (seeded from the empty-state "Seed
 * sample traces" path; every span carries `langwatch.origin = "sample"`)
 * are not a real first ingest. Flipping `firstMessage` / `integrated` on
 * them would prematurely dismiss the empty-state onboarding card even
 * though the user hasn't connected their own app yet. Skip entirely —
 * a real trace will trigger this reactor again.
 */
function isRealFirstIngest(foldState: TraceSummaryData): boolean {
  return foldState.attributes?.["langwatch.origin"] !== "sample";
}

export function createProjectMetadataReactor(
  deps: ProjectMetadataReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "projectMetadata",
    shouldReact: (_event, context) => isRealFirstIngest(context.foldState),
    options: {
      runIn: ["worker"],
      makeJobId: (payload) =>
        `project-meta:${payload.event.tenantId}`,
      ttl: 60_000, // 60s dedup — avoid repeated writes for the same project
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;
      const attrs = foldState.attributes ?? {};

      if (!isRealFirstIngest(foldState)) return;

      try {
        const project = await deps.projects.getById(tenantId);

        if (!project) {
          logger.warn({ tenantId }, "Project not found — skipping metadata update");
          return;
        }

        // Level-triggered, so it runs BEFORE the already-marked early return
        // below: an established project is exactly the case that used to be
        // unreachable here, and exactly the case the deploy backfill existed
        // to repair.
        //
        // Own error handling: a bootstrap failure must not be reported as a
        // metadata failure, and must not stop the metadata write that follows.
        // Failing is survivable now — the next trace re-asserts it.
        try {
          await deps.bootstrapTopicClustering?.(tenantId);
        } catch (error) {
          logger.error(
            {
              tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Topic clustering bootstrap failed — retried on this project's next trace (non-fatal)",
          );
        }

        // Already marked — nothing to do
        if (project.firstMessage && project.integrated) {
          return;
        }

        const isOptimizationStudio =
          attrs["langwatch.platform"] === "optimization_studio";

        const sdkLanguage = attrs["sdk.language"];
        const language =
          isOptimizationStudio
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
  };
}
