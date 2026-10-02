import type { Event, SubscriberDispatchDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import { UsageCountingService } from "../services/usage-counting.service.ts";
import type { CountMonthCommandData } from "./usage.events.ts";

const logger = createLogger("langwatch:usage:meterCount");

export const USAGE_METER_COUNT_SUBSCRIBER_NAME = "usageMeterCount";
const SUPPRESS_MS = 300_000;
/** Days into a month during which last month is still recounted, as billing's dispatch did. */
const GRACE_PERIOD_DAYS = 3;

/** Asks for the month's count after the meter records an event: one job per project per window. */
export function usageMeterCountSubscriber({
  projects,
  countMonth,
}: {
  projects: Pick<ProjectApi, "findOrganizationId">;
  countMonth: (data: CountMonthCommandData) => Promise<void>;
}): SubscriberDispatchDefinition<Event> {
  return {
    name: USAGE_METER_COUNT_SUBSCRIBER_NAME,
    options: {
      runIn: ["worker"],
      groupKeyFn: (payload) => `usage-meter-count:${payload.event.tenantId}`,
      makeJobId: (payload) => `usage_count_${payload.event.tenantId}`,
      ttl: SUPPRESS_MS,
    },
    handle: async (_event, context) => {
      const organizationId = await projects.findOrganizationId(context.tenantId);
      if (!organizationId) return;
      const now = nowInstant();
      const occurredAt = now.epochMilliseconds;
      const months = [UsageCountingService.monthOf(occurredAt)];
      if (now.toZonedDateTimeISO("UTC").day <= GRACE_PERIOD_DAYS) {
        months.unshift(
          UsageCountingService.monthOf(
            now.toZonedDateTimeISO("UTC").subtract({ months: 1 }).epochMilliseconds,
          ),
        );
      }
      try {
        for (const month of months) {
          await countMonth({ tenantId: organizationId, organizationId, month, occurredAt });
        }
      } catch (error) {
        logger.warn(
          { organizationId, error },
          "failed to ask for the month's count; the rows are safe in ClickHouse",
        );
      }
    },
  };
}
