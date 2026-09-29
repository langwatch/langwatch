/**
 * A connected agent's successful run tells nurturing, against the admin the
 * finished event carries. @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { createScenarioRunSucceededNurturingSubscriber } from "../scenario-run-succeeded-nurturing.subscriber.ts";

function finished(
  data: Partial<SimulationRunFinishedEvent["data"]> = {},
): SimulationRunFinishedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      status: "SUCCESS",
      target: { type: "connected", referenceId: "agent-1" },
      organizationAdmin: { userId: "admin-1", onboardingVariant: "classic" },
      ...data,
    },
  };
}

async function signalsFor(event: SimulationRunFinishedEvent): Promise<NurturingSignal[]> {
  const recorded: NurturingSignal[] = [];
  const subscriber = createScenarioRunSucceededNurturingSubscriber({
    recordSignal: async (signal) => {
      recorded.push(signal);
    },
  });
  await subscriber.handler(event, {
    tenantId: "project-1",
    aggregateId: "run-1",
    state: undefined,
  });
  return recorded;
}

describe("the scenario-run-succeeded nurturing subscriber", () => {
  describe("when a connected agent's run finishes with a verdict", () => {
    /** @scenario "a scenario run that finished against a connected agent is tracked as succeeded" */
    it("tells nurturing the run against the admin, with its variant", async () => {
      expect(await signalsFor(finished())).toEqual([
        {
          kind: "scenario_run_succeeded",
          sourceEventId: "event-1",
          tenantId: "project-1",
          occurredAt: 1_700_000_000_000,
          userId: "admin-1",
          projectId: "project-1",
          scenarioId: "scenario-1",
          runId: "run-1",
          onboardingVariant: "classic",
        },
      ]);
    });
  });

  describe("when the finished event names no admin", () => {
    it("tells nurturing nothing", async () => {
      expect(await signalsFor(finished({ organizationAdmin: undefined }))).toEqual([]);
    });
  });

  describe("when the run was against anything but a connected agent", () => {
    it("tells nurturing nothing", async () => {
      expect(
        await signalsFor(finished({ target: { type: "prompt", referenceId: "prompt-1" } })),
      ).toEqual([]);
    });
  });
});
