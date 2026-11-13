/**
 * @vitest-environment node
 * @see specs/scenarios/judge-trace-wait-settings.feature
 */
import { describe, expect, it } from "vitest";

import { errorCodeOf, mountSuiteFamilies } from "./suite-rest.harness.ts";

const BASE = "/api/v1/run-plans";

describe("given a run plan configuration with judge trace wait settings", () => {
  describe("when it is run through the run plans REST API", () => {
    /** @scenario "The run plans REST API takes and answers the judge trace wait settings" */
    it("stores them on the plan, queues them on every run and answers them on the read", async () => {
      const { api, world, commands } = mountSuiteFamilies();
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();

      const response = await api.post(`${BASE}/run`, {
        name: "Nightly",
        config: {
          scope: { mode: "scenarios" },
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
          traceQuietPeriodMs: 20_000,
          traceWaitTimeoutMs: 90_000,
        },
        idempotencyKey: "trace-wait-key-1",
      });

      expect(response.status).toBe(200);
      const { runPlanId } = (await response.json()) as { runPlanId: string };
      expect(commands.queued[0]).toMatchObject({
        traceQuietPeriodMs: 20_000,
        traceWaitTimeoutMs: 90_000,
      });

      const read = await api.get(`${BASE}/${runPlanId}`);
      expect(read.status).toBe(200);
      await expect(read.json()).resolves.toMatchObject({
        traceQuietPeriodMs: 20_000,
        traceWaitTimeoutMs: 90_000,
      });
    });
  });

  describe("when a plan without them is read", () => {
    /** @scenario "The run plans REST API takes and answers the judge trace wait settings" */
    it("answers both as null", async () => {
      const { api, world } = mountSuiteFamilies();
      const plan = world.addPlan({ name: "Plain" });

      const read = await api.get(`${BASE}/${plan.id}`);

      await expect(read.json()).resolves.toMatchObject({
        traceQuietPeriodMs: null,
        traceWaitTimeoutMs: null,
      });
    });
  });

  describe("when a test suite is run with them", () => {
    /** @scenario "The run plans REST API takes and answers the judge trace wait settings" */
    it("queues them on every run", async () => {
      const { api, world, commands } = mountSuiteFamilies();
      const { testSuite } = world.addTestSuiteWithCases("Refunds", 1);
      const agent = world.addAgent();

      const response = await api.post(`/api/v1/test-suites/${testSuite.id}/run`, {
        targets: [{ type: "http", referenceId: agent.id }],
        traceQuietPeriodMs: 0,
        traceWaitTimeoutMs: 1_000,
      });

      expect(response.status).toBe(200);
      expect(commands.queued[0]).toMatchObject({
        traceQuietPeriodMs: 0,
        traceWaitTimeoutMs: 1_000,
      });
    });
  });
});

describe("given judge trace wait settings outside their bounds", () => {
  /** @scenario "The run plans REST API refuses judge trace wait settings outside their bounds" */
  it("answers 422 validation_error naming each field and schedules nothing", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const scenario = world.addScenario({ name: "Refund Flow" });
    const agent = world.addAgent();

    const response = await api.post(`${BASE}/run`, {
      config: {
        scope: { mode: "scenarios" },
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: agent.id }],
        traceQuietPeriodMs: 60_001,
        traceWaitTimeoutMs: 999,
      },
      idempotencyKey: "trace-wait-key-2",
    });

    expect(response.status).toBe(422);
    const body: { meta?: { reasons?: { meta?: { field?: string } }[] } } = await response
      .clone()
      .json();
    await expect(errorCodeOf(response)).resolves.toBe("validation_error");
    const fields = (body.meta?.reasons ?? []).map((reason) => reason.meta?.field);
    expect(fields).toEqual(
      expect.arrayContaining(["config.traceQuietPeriodMs", "config.traceWaitTimeoutMs"]),
    );
    expect(commands.queued).toHaveLength(0);
  });
});
