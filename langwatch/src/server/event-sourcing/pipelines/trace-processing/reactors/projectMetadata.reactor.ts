import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:project-metadata-reactor",
);

export interface ProjectMetadataReactorDeps {
  projects: ProjectService;
  /**
   * ADR-051: a project's first real trace also bootstraps its topic
   * clustering process (creates the process row and schedules the first
   * daily wake). Best-effort — the backfill task is the reconciliation path.
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

        // Own error handling: by this point the metadata write has already
        // COMMITTED, so letting a bootstrap failure fall through to the outer
        // catch would report "Failed to update project metadata" for a write
        // that succeeded — and hide the thing that actually broke. A failure
        // here means the project has no scheduled clustering wake; the deploy
        // backfill (backfillTopicClusteringSchedules) is the recovery path.
        if (!project.firstMessage) {
          try {
            await deps.bootstrapTopicClustering?.(tenantId);
          } catch (error) {
            logger.error(
              {
                tenantId,
                error: error instanceof Error ? error.message : String(error),
              },
              "Project metadata updated, but topic clustering bootstrap failed — project has no scheduled clustering wake until the backfill task re-runs (non-fatal)",
            );
          }
        }
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
