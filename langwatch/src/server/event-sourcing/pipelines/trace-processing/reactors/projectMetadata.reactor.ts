import type { PrismaClient } from "@prisma/client";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:project-metadata-reactor",
);

export interface ProjectMetadataReactorDeps {
  prisma: PrismaClient;
}

/**
 * Reactor that marks the project as having received its first message.
 *
 * Sets project.firstMessage = true, project.integrated (unless optimization_studio),
 * and detects the SDK language from span resource attributes.
 *
 * Uses a long dedup TTL so we only hit Prisma once per project in a given window.
 */
export function createProjectMetadataReactor(
  deps: ProjectMetadataReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "projectMetadata",
    options: {
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
        const project = await deps.prisma.project.findUnique({
          where: { id: tenantId },
          select: { id: true, firstMessage: true, integrated: true },
        });

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

        await deps.prisma.project.update({
          where: { id: tenantId },
          data: {
            firstMessage: true,
            integrated: isOptimizationStudio ? project.integrated : true,
            language,
          },
        });

        logger.info(
          { tenantId, language, isOptimizationStudio },
          "Marked project first message",
        );
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
