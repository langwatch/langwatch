import { createLogger } from "~/utils/logger/server";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "../../../../../ee/billing/services/billableEventsQuery";
import type { ReportUsageForMonthCommandData } from "../../pipelines/billing-reporting/schemas/commands";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";

const logger = createLogger("langwatch:billing:meterDispatch");

/** Number of days at the start of a new month to also check the previous month. */
const GRACE_PERIOD_DAYS = 3;

/**
 * Reactor that dispatches billing usage reporting commands after
 * the projectDailyBillableEvents fold succeeds.
 *
 * Two dedup layers:
 * - Reactor-level per-project: makeJobId creates one reactor job per project.
 *   An org with N active projects creates N reactor jobs but each project
 *   only triggers one within the TTL window.
 * - Framework per-org: command dedup via makeId `${orgId}:${billingMonth}`, 310s TTL
 *   ensures only one reporting command per org per month is pending.
 *
 * Grace period: during the first 3 days of a month, dispatches for both
 * current and previous billing month to catch late-arriving events.
 */
export function createBillingMeterDispatchReactor(deps: {
  getDispatch: () => (data: ReportUsageForMonthCommandData) => Promise<void>;
}): ReactorDefinition<Event> {
  return {
    name: "billingMeterDispatch",
    options: {
      runIn: ["worker"],
      makeJobId: (payload) =>
        `billing_dispatch_${payload.event.tenantId}`,
      ttl: 300_000,
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

      const now = new Date();
      const billingMonth = getBillingMonth(now);

      try {
        const dispatch = deps.getDispatch();

        // Grace period: dispatch for previous month during first days of a new month
        if (now.getUTCDate() <= GRACE_PERIOD_DAYS) {
          const prevMonth = getPreviousBillingMonth(now);
          await dispatch({
            organizationId: orgId,
            billingMonth: prevMonth,
            tenantId: orgId,
            occurredAt: Date.now(),
          });
        }

        // Always dispatch for current month
        await dispatch({
          organizationId: orgId,
          billingMonth,
          tenantId: orgId,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.warn(
          { organizationId: orgId, error },
          "failed to dispatch usage reporting command, events are safe in ClickHouse",
        );
      }
    },
  };
}
