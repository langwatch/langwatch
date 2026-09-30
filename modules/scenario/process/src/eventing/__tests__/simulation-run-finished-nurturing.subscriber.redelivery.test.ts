import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { createSimulationRunFinishedNurturingSubscriber } from "../simulation-run-finished-nurturing.subscriber.ts";

const event: SimulationRunFinishedEvent = {
  id: "event-1",
  aggregateId: "run-1",
  aggregateType: "simulation_run",
  tenantId: createTenantId("project-1"),
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
  type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
  version: SIMULATION_EVENT_VERSIONS.FINISHED,
  data: { scenarioRunId: "run-1" },
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

describe("the simulation-run-finished nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const target = nurturing();
    const subscriber = createSimulationRunFinishedNurturingSubscriber({
      projects: {
        resolveOrgAdmin: async () => ({
          userId: "admin-1",
          organizationId: "org-1",
          firstMessage: true,
          onboardingVariant: null,
          organizationCreatedAt: null,
        }),
        listIdsByOrganization: async () => ["project-1"],
      },
      simulations: { countOrganizationRuns: async () => 3 },
      nurturing: target,
    });

    await subscriber.handler(event, context);
    await subscriber.handler(event, context);

    expect([...target.signals.values()]).toHaveLength(1);
  });
});
