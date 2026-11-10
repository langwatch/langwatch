import { EventSchema } from "@langwatch/eventing";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { scenarioRunCountSubscriber } from "../scenario-run-count.subscriber.ts";
import type { CountScenarioRunsCommandData } from "../usage.events.ts";

const runStarted = EventSchema.parse({
  id: "evt_1",
  aggregateId: "run_1",
  aggregateType: "simulation_run",
  tenantId: "project_alpha",
  createdAt: 1_772_539_200_000,
  occurredAt: 1_772_539_200_000,
  type: SIMULATION_RUN_EVENT_TYPES.STARTED,
  version: "2026-01-01",
  data: {},
});

describe("scenarioRunCount redelivery", () => {
  it("asks for the same month count when one run start is handled twice", async () => {
    // countScenarioRuns collapses on `${organizationId}:${month}`: it recounts, never increments.
    const calls: CountScenarioRunsCommandData[] = [];
    const subscriber = scenarioRunCountSubscriber({
      projects: {
        getProjectPlacement: async () => ({ kind: "placed" as const, organizationId: "org_1" }),
      },
      countScenarioRuns: async (data: CountScenarioRunsCommandData) => {
        calls.push(data);
      },
    });
    const context = { tenantId: "project_alpha", aggregateId: "run_1", foldState: undefined };

    await subscriber.handle(runStarted, context);
    await subscriber.handle(runStarted, context);

    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(first).toMatchObject({ organizationId: "org_1", tenantId: "org_1" });
    expect(second).toMatchObject({ organizationId: first!.organizationId, month: first!.month });
  });
});
