import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { createScenarioRunSucceededNurturingSubscriber } from "../scenario-run-succeeded-nurturing.subscriber.ts";

const event: SimulationRunFinishedEvent = {
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
    organizationAdmin: { userId: "admin-1", onboardingVariant: "guided" },
  },
};

const context = { tenantId: "project-1", aggregateId: "run-1", state: undefined };

/** Nurturing as it behaves: one signal per kind and source event, however often it is told. */
function nurturing() {
  const signals = new Map<string, NurturingSignal>();
  return {
    signals,
    recordSignal: async (signal: NurturingSignal) => {
      signals.set(`${signal.kind}:${signal.sourceEventId}`, signal);
    },
  };
}

describe("the scenario-run-succeeded nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const target = nurturing();
    const subscriber = createScenarioRunSucceededNurturingSubscriber(target);

    await subscriber.handler(event, context);
    await subscriber.handler(event, context);

    expect([...target.signals.values()]).toHaveLength(1);
  });
});
