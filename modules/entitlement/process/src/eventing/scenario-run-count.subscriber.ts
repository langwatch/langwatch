import type { Event, SubscriberDispatchDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import type { TenancyRepository } from "../repositories/tenancy.repository.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";
import type { CountScenarioRunsCommandData } from "./usage.events.ts";

const logger = createLogger("langwatch:entitlement:scenarioRunCount");

export const SCENARIO_RUN_COUNT_SUBSCRIBER_NAME = "scenarioRunCount";
const SUPPRESS_MS = 60_000;

/** Asks for the month's scenario run count after the meter records a run start. */
export function scenarioRunCountSubscriber({
  projects,
  countScenarioRuns,
}: {
  projects: Pick<TenancyRepository, "getProjectPlacement">;
  countScenarioRuns: (data: CountScenarioRunsCommandData) => Promise<void>;
}): SubscriberDispatchDefinition<Event> {
  return {
    name: SCENARIO_RUN_COUNT_SUBSCRIBER_NAME,
    shouldDispatch: (event) => event.type === SIMULATION_RUN_EVENT_TYPES.STARTED,
    options: {
      runIn: ["worker"],
      groupKeyFn: (payload) => `scenario-run-count:${payload.event.tenantId}`,
      makeJobId: (payload) => `scenario_run_count_${payload.event.tenantId}`,
      ttl: SUPPRESS_MS,
    },
    handle: async (_event, context) => {
      const placement = await projects.getProjectPlacement({ projectId: context.tenantId });
      if (placement.kind === "unplaced") return;
      const { organizationId } = placement;
      const occurredAt = nowInstant().epochMilliseconds;
      const month = UsageCountingService.monthOf(occurredAt);
      try {
        await countScenarioRuns({ tenantId: organizationId, organizationId, month, occurredAt });
      } catch (error) {
        logger.warn({ organizationId, error }, "failed to ask for the month's scenario run count");
      }
    },
  };
}
