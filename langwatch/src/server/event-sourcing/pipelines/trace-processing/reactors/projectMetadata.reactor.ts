import type { ProjectService } from "~/server/app-layer/projects/project.service";

import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:project-metadata-reactor",
);

export interface ProjectMetadataReactorDeps {
  projects: ProjectService;
}

/**
 * Reactor that marks the project as having received its first message.
 *
 * Sets project.firstMessage = true, project.integrated (unless optimization_studio),
 * and detects the SDK language from span resource attributes.
 *
 * Uses a long dedup TTL so we only hit the database once per project in a given window.
 */
export function createProjectMetadataReactor(
  deps: ProjectMetadataReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "projectMetadata",
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

        await deps.projects.updateMetadata(tenantId, {
          firstMessage: true,
          integrated: isOptimizationStudio ? project.integrated : true,
          language,
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
