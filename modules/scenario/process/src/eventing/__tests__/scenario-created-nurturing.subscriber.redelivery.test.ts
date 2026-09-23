import { createTenantId } from "@langwatch/eventing";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SCENARIO_CREATED_EVENT_VERSION,
  type ScenarioCreatedEvent,
  type ScenarioCreatedEventData,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import type { ScenarioCreatedNurturingDeps } from "../scenario-created-nurturing.subscriber.ts";
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

function subscriberOf(deps: ScenarioCreatedNurturingDeps) {
  const subscriber = buildScenarioLifecyclePipeline(deps).eventSubscribers.get(
    "scenarioCreatedNurturing",
  );
  if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");
  return subscriber;
}

function claims(): (key: string) => Promise<boolean> {
  const seen = new Set<string>();
  return async (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

describe("the scenario-created nurturing subscriber on redelivery", () => {
  it("announces a created scenario to billing once when the event is handled twice", async () => {
    const announced: ScenarioCreatedEventData[] = [];
    const subscriber = subscriberOf({
      announce: async (signal) => {
        announced.push(signal);
      },
      claim: claims(),
    });

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect(announced).toEqual([event.data]);
  });

  it("does not repeat an announcement that failed, as main's fire-and-forget did not", async () => {
    let calls = 0;
    const subscriber = subscriberOf({
      announce: async () => {
        calls += 1;
        throw new Error("billing unavailable");
      },
      claim: claims(),
    });

    await expect(subscriber.handle(event, context)).rejects.toThrow("billing unavailable");
    await subscriber.handle(event, context);

    expect(calls).toBe(1);
  });
});
