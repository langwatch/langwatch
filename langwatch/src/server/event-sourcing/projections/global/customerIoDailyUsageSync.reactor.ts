import type { PrismaClient } from "@prisma/client";
import type { NurturingService } from "../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../app-layer/projects/project.service";
import { CIO_REACTOR_DEBOUNCE_TTL_MS } from "../../pipelines/trace-processing/reactors/customerIoTraceSync.reactor";
import { createLogger } from "../../../../utils/logger/server";
import { captureException } from "../../../../utils/posthogErrorCapture";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import type { ProjectDailySdkUsageState } from "./projectDailySdkUsage.store";

const logger = createLogger(
  "langwatch:global:customer-io-daily-usage-sync-reactor",
);

export interface CustomerIoDailyUsageSyncReactorDeps {
  projects: ProjectService;
  prisma: PrismaClient;
  nurturing: NurturingService;
}

/**
 * Reactor that pushes aggregated daily usage metrics to Customer.io
 * after the projectDailySdkUsage fold completes.
 *
 * Registered on the global projectDailySdkUsage fold projection.
 *
 * Sends cumulative totals (not reset counters):
 *   - trace_count: total traces across all days
 *   - daily_trace_count: traces for today
 *   - trace_count_updated_at: ISO 8601 timestamp of the fold completion
 *
 * Debounced via makeJobId with 5-minute TTL to avoid excessive CIO calls
 * during high-volume ingestion.
 *
 * All nurturing calls are fire-and-forget with captureException.
 */
export function createCustomerIoDailyUsageSyncReactor(
  deps: CustomerIoDailyUsageSyncReactorDeps,
): ReactorDefinition<Event, ProjectDailySdkUsageState> {
  return {
    name: "customerIoDailyUsageSync",
    options: {
      makeJobId: (payload) =>
        `cio-daily-usage-${payload.event.tenantId}`,
      ttl: CIO_REACTOR_DEBOUNCE_TTL_MS,
    },

    async handle(_event, context) {
      const { foldState } = context;
      const projectId = foldState.projectId;

      if (!projectId) {
        return;
      }

      try {
        const { userId } = await deps.projects.resolveOrgAdmin(projectId);

        if (!userId) {
          logger.warn(
            { projectId },
            "No admin user found for project — skipping CIO daily usage sync",
          );
          return;
        }

        // Cumulative total across all days
        const cumulativeResult = await deps.prisma.projectDailySdkUsage.aggregate({
          where: { projectId },
          _sum: { count: true },
        });
        const traceCount = cumulativeResult._sum.count ?? 0;

        // Today's date in UTC
        const today = new Date().toISOString().split("T")[0]!;

        // Daily count for today
        const todayRows = await deps.prisma.projectDailySdkUsage.findMany({
          where: { projectId, date: today },
          select: { count: true },
        });
        const dailyTraceCount = todayRows.reduce(
          (sum, row) => sum + row.count,
          0,
        );

        const now = new Date().toISOString();

        // Fire-and-forget: do not block reactor processing
        void deps.nurturing
          .identifyUser({ userId, traits: {
            trace_count: traceCount,
            daily_trace_count: dailyTraceCount,
            trace_count_updated_at: now,
          }})
          .catch((error) => {
            logger.error(
              { projectId, error },
              "Failed to identify user for daily usage sync",
            );
            captureException(error);
          });
      } catch (error) {
        logger.error(
          { projectId, error },
          "Failed to process CIO daily usage sync — non-fatal",
        );
        captureException(error);
      }
    },
  };
}
