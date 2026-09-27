/**
 * Redelivery is at-least-once: the same finished-run event handled twice must
 * track `scenario_run_succeeded` once.
 */
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { MemoryProjectActiveDayRepository } from "../../repositories/memory/memory.project-active-day.repository.ts";
import { MemoryScenarioRunMilestoneClaimRepository } from "../../repositories/memory/memory.scenario-run-milestone-claim.repository.ts";
import { ProjectActiveDayTrackerService } from "../../services/project-active-day-tracker.service.ts";
import { createScenarioRunMilestonesSubscriber } from "../scenario-run-milestones.subscriber.ts";

const OCCURRED_AT = Date.UTC(2026, 8, 13, 10, 0, 0);

const finished: SimulationRunFinishedEvent = {
  id: "event-1",
  aggregateId: "run-1",
  aggregateType: "simulation_run",
  tenantId: createTenantId("project-1"),
  createdAt: OCCURRED_AT,
  occurredAt: OCCURRED_AT,
  type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
  version: SIMULATION_EVENT_VERSIONS.FINISHED,
  data: {
    scenarioRunId: "run-1",
    scenarioId: "scenario-1",
    target: { type: "connected", referenceId: "agent-1" },
    results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
    status: "SUCCESS",
  },
};

const context = { tenantId: "project-1", aggregateId: "run-1", state: null };

describe("scenario-run milestones subscriber redelivery", () => {
  it("tracks scenario_run_succeeded once when the same event is handled twice", async () => {
    const posthog = MemoryPostHogChannel.create();
    const resolveOrgAdmin = async () => ({
      userId: "admin-1",
      organizationId: "org-1",
      onboardingVariant: null,
      organizationCreatedAt: null,
    });
    const subscriber = createScenarioRunMilestonesSubscriber({
      resolveOrgAdmin,
      posthog,
      activeDayTracker: ProjectActiveDayTrackerService.create({
        posthog,
        repository: MemoryProjectActiveDayRepository.create(),
        resolveOrgAdmin,
      }),
      milestoneClaims: MemoryScenarioRunMilestoneClaimRepository.create(),
    });

    await subscriber.handler(finished, context);
    await subscriber.handler(finished, context);

    expect(posthog.tracked.map((entry) => entry.event)).toEqual([
      "scenario_run_succeeded",
      "project_active_day",
    ]);
  });
});
