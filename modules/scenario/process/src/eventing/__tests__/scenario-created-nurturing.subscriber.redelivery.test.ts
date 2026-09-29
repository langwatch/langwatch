import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SCENARIO_CREATED_EVENT_VERSION,
  type ScenarioCreatedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { buildScenarioLifecyclePipeline } from "../scenario-lifecycle.pipeline.ts";

const event: ScenarioCreatedEvent = {
  id: "event-1",
  aggregateId: "scenario-1",
  aggregateType: "scenario",
  tenantId: createTenantId("project-1"),
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
  type: SCENARIO_CREATED_EVENT_TYPE,
  version: SCENARIO_CREATED_EVENT_VERSION,
  data: { scenarioId: "scenario-1", projectId: "project-1", userId: "user-1", scenarioCount: 1 },
};

const context = { tenantId: "project-1", aggregateId: "scenario-1" };

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

describe("the scenario-created nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const target = nurturing();
    const subscriber = buildScenarioLifecyclePipeline(target).eventSubscribers.get(
      "scenarioCreatedNurturing",
    );
    if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect([...target.signals.values()]).toEqual([
      {
        kind: "scenario_created",
        sourceEventId: "event-1",
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        scenarioId: "scenario-1",
        projectId: "project-1",
        userId: "user-1",
        scenarioCount: 1,
      },
    ]);
  });
});
