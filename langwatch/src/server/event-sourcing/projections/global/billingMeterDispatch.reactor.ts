import type { Queue } from "bullmq";
import { createLogger } from "~/utils/logger/server";
import { USAGE_REPORTING_QUEUE } from "~/server/background/queues/constants";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";

const logger = createLogger("langwatch:billing:meterDispatch");

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Reactor that dispatches billing usage reporting jobs after
 * the projectDailyBillableEvents fold succeeds.
 *
 * Two dedup layers:
 * - Reactor-level per-project: makeJobId creates one reactor job per project.
 *   An org with N active projects creates N reactor jobs but each project
 *   only triggers one within the TTL window.
 * - BullMQ per-org: jobId `usage_report_${orgId}` ensures only one reporting
 *   job per org is active within the delay window.
 */
export function createBillingMeterDispatchReactor(deps: {
  getUsageReportingQueue: () => Promise<Queue | null>;
}): ReactorDefinition<Event> {
  return {
    name: "billingMeterDispatch",
    options: {
      runIn: ["worker"],
      makeJobId: (payload) =>
        `billing_dispatch_${payload.event.tenantId}`,
      ttl: 300_000, // 5 min dedup window
    },

    async handle(event, context) {
      const orgId = await resolveOrganizationId(context.tenantId);

      if (!orgId) {
        logger.warn(
          { projectId: context.tenantId },
          "orphan project detected, has no organization -- skipping billing dispatch",
        );
        return;
      }

      const queue = await deps.getUsageReportingQueue();
      if (!queue) return;

      try {
        await queue.add(
          USAGE_REPORTING_QUEUE.JOB,
          { organizationId: orgId },
          {
            jobId: `usage_report_${orgId}`,
            delay: FIVE_MINUTES_MS,
          },
        );
      } catch (error) {
        logger.warn(
          { organizationId: orgId, error },
          "failed to enqueue usage reporting job, events are safe in ClickHouse",
        );
      }
    },
  };
}
