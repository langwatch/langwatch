/**
 * @vitest-environment node
 * @see specs/api-reference/run-plans-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { errorCodeOf, mountSuiteFamilies } from "./support/suite-family.harness";

const BASE = "/api/v1/run-plans";

describe("given the project holds one active plan and one archived plan", () => {
  describe("when the run plans are listed", () => {
    // @scenario "Listing run plans leaves out archived plans"
    it("returns only the active plan", async () => {
      const { api, world } = mountSuiteFamilies();
      const active = world.addPlan({ name: "Nightly" });
      world.addPlan({ name: "Old", archivedAt: new Date("2026-01-02T00:00:00.000Z") });

      const response = await api.get(BASE);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; platformUrl: string }[];
      expect(body.map((plan) => plan.id)).toEqual([active.id]);
      expect(body[0]?.platformUrl).toContain(active.slug);
    });

    // @scenario "Listing run plans includes archived plans when asked"
    it("returns both when includeArchived is set", async () => {
      const { api, world } = mountSuiteFamilies();
      world.addPlan({ name: "Nightly" });
      world.addPlan({ name: "Old", archivedAt: new Date("2026-01-02T00:00:00.000Z") });

      const response = await api.get(`${BASE}?includeArchived=true`);

      expect(response.status).toBe(200);
      expect((await response.json()) as unknown[]).toHaveLength(2);
    });
  });
});

describe("given the project holds one run plan and one test suite", () => {
  // @scenario "Listing run plans leaves out test suites"
  it("returns only the run plan", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });
    world.addTestSuite({ name: "Refunds" });

    const response = await api.get(BASE);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string }[];
    expect(body.map((one) => one.id)).toEqual([plan.id]);
  });
});

describe("given an id the project does not hold", () => {
  // @scenario "Reading a run plan that does not exist answers suite_not_found"
  it("answers 404 naming the code", async () => {
    const { api } = mountSuiteFamilies();

    const response = await api.get(`${BASE}/suite_nonexistent`);

    expect(response.status).toBe(404);
    await expect(errorCodeOf(response)).resolves.toBe("suite_not_found");
  });
});

describe("given the id names a test suite", () => {
  // @scenario "Reading a test suite through the run plan route answers suite_not_found"
  it("answers 404 naming the code", async () => {
    const { api, world } = mountSuiteFamilies();
    const testSuite = world.addTestSuite({ name: "Refunds" });

    const response = await api.get(`${BASE}/${testSuite.id}`);

    expect(response.status).toBe(404);
    await expect(errorCodeOf(response)).resolves.toBe("suite_not_found");
  });
});

describe("given a configuration over one scenario and one agent", () => {
  describe("when it is run under a name nothing answers to", () => {
    // @scenario "Running a configuration creates the run plan its name resolves"
    it("creates the plan and schedules the runs", async () => {
      const { api, world, commands } = mountSuiteFamilies();
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();

      const response = await api.post(`${BASE}/run`, {
        name: "Nightly",
        config: {
          scope: { mode: "scenarios" },
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
        },
        idempotencyKey: "run-plan-key-1",
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        batchRunId: string;
        runPlanId: string;
        platformUrl: string;
      };
      expect(body).toMatchObject({
        scheduled: true,
        jobCount: 1,
        planName: "Nightly",
        created: true,
      });
      expect(commands.queued).toHaveLength(1);
      expect(commands.started[0]).toMatchObject({
        batchRunId: body.batchRunId,
        idempotencyKey: "run-plan-key-1",
      });
      const stored = world.plans.get(body.runPlanId);
      expect(stored?.name).toBe("Nightly");
      expect(stored?.kind).toBe("run_plan");
      expect(body.platformUrl).toContain(stored?.slug);
    });
  });

  describe("when the same name is run twice", () => {
    // @scenario "Running the same name twice joins the run plan already there"
    it("joins the plan the first run resolved", async () => {
      const { api, world } = mountSuiteFamilies();
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();
      const config = {
        scope: { mode: "scenarios" },
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: agent.id }],
      };

      const first = await api.post(`${BASE}/run`, {
        name: "Nightly",
        config,
        idempotencyKey: "run-plan-key-2a",
      });
      const second = await api.post(`${BASE}/run`, {
        name: "Nightly",
        config,
        idempotencyKey: "run-plan-key-2b",
      });

      expect(second.status).toBe(200);
      const firstBody = (await first.json()) as { runPlanId: string };
      const secondBody = (await second.json()) as { runPlanId: string; created: boolean };
      expect(secondBody.created).toBe(false);
      expect(secondBody.runPlanId).toBe(firstBody.runPlanId);
    });
  });

  describe("when the key behind the run belongs to no person", () => {
    // @scenario "A run started with a key that names no person records no actor"
    it("records no actor on the queued run", async () => {
      const { api, world, commands } = mountSuiteFamilies({ caller: { userId: null } });
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();

      const response = await api.post(`${BASE}/run`, {
        config: {
          scope: { mode: "scenarios" },
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
        },
        idempotencyKey: "run-plan-actor-1",
      });

      expect(response.status).toBe(200);
      const langwatch = langwatchMetadata(commands.queued[0]?.metadata);
      expect(langwatch).not.toHaveProperty("actorId");
      expect(langwatch).not.toHaveProperty("actorLabel");
    });
  });

  describe("when the key behind the run belongs to a person", () => {
    // @scenario "A run started with a key that names a person records the api actor"
    it("records the api actor on the queued run", async () => {
      const { api, world, commands } = mountSuiteFamilies({ caller: { userId: "user-runner" } });
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();

      const response = await api.post(`${BASE}/run`, {
        config: {
          scope: { mode: "scenarios" },
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
        },
        idempotencyKey: "run-plan-actor-2",
      });

      expect(response.status).toBe(200);
      expect(langwatchMetadata(commands.queued[0]?.metadata)).toMatchObject({
        actorId: "user-runner",
        actorLabel: "api",
      });
    });

    // @scenario "A run started from the command line records the cli actor"
    it("records the cli actor when the surface header says so", async () => {
      const { api, world, commands } = mountSuiteFamilies({ caller: { userId: "user-runner" } });
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();

      const response = await api.post(
        `${BASE}/run`,
        {
          config: {
            scope: { mode: "scenarios" },
            scenarioIds: [scenario.id],
            targets: [{ type: "http", referenceId: agent.id }],
          },
          idempotencyKey: "run-plan-actor-3",
        },
        { "X-LangWatch-Surface": "cli" },
      );

      expect(response.status).toBe(200);
      expect(langwatchMetadata(commands.queued[0]?.metadata)).toMatchObject({
        actorId: "user-runner",
        actorLabel: "cli",
      });
    });
  });

  describe("when it names no target", () => {
    // @scenario "Running a configuration with no target is refused with suite_targets_required"
    it("answers 422 suite_targets_required and schedules nothing", async () => {
      const { api, world, commands } = mountSuiteFamilies();
      const scenario = world.addScenario({ name: "Refund Flow" });

      const response = await api.post(`${BASE}/run`, {
        config: { scope: { mode: "scenarios" }, scenarioIds: [scenario.id], targets: [] },
        idempotencyKey: "run-plan-key-3",
      });

      expect(response.status).toBe(422);
      await expect(errorCodeOf(response)).resolves.toBe("suite_targets_required");
      expect(commands.started).toHaveLength(0);
      expect(commands.queued).toHaveLength(0);
    });
  });

  describe("when it names a model with no provider prefix", () => {
    // @scenario "A run plan model that is not a provider/model id is refused"
    it("answers 422 validation_error naming the field and schedules nothing", async () => {
      const { api, world, commands } = mountSuiteFamilies();
      const scenario = world.addScenario({ name: "Refund Flow" });
      const agent = world.addAgent();

      const response = await api.post(`${BASE}/run`, {
        config: {
          scope: { mode: "scenarios" },
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
          simulatorModel: "latest",
        },
        idempotencyKey: "run-plan-key-model",
      });

      expect(response.status).toBe(422);
      const body = (await response.clone().json()) as {
        reasons?: { code: string; meta?: { field?: string } }[];
      };
      await expect(errorCodeOf(response)).resolves.toBe("validation_error");
      expect(body.reasons ?? []).toContainEqual(
        expect.objectContaining({
          code: "schema_failure",
          meta: expect.objectContaining({ field: "config.simulatorModel" }),
        }),
      );
      expect(commands.started).toHaveLength(0);
      expect(commands.queued).toHaveLength(0);
    });
  });
});

describe("given a stored run plan", () => {
  // @scenario "Running a stored run plan again runs the configuration it holds"
  it("schedules the runs it already holds", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const scenario = world.addScenario({ name: "Refund Flow" });
    const agent = world.addAgent();
    const plan = world.addPlan({
      name: "Runnable plan",
      scenarioIds: [scenario.id],
      targets: [{ type: "http", referenceId: agent.id }],
    });

    const response = await api.post(`${BASE}/${plan.id}/run`, { idempotencyKey: "rerun-key-1" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scheduled: true,
      jobCount: 1,
      runPlanId: plan.id,
      planName: "Runnable plan",
      created: false,
    });
    expect(commands.queued).toHaveLength(1);
  });

  // @scenario "Running a stored run plan that does not exist answers suite_not_found"
  it("answers 404 for an id the project does not hold", async () => {
    const { api } = mountSuiteFamilies();

    const response = await api.post(`${BASE}/suite_nonexistent/run`, {});

    expect(response.status).toBe(404);
    await expect(errorCodeOf(response)).resolves.toBe("suite_not_found");
  });
});

describe("given a run plan the project holds", () => {
  // @scenario "Archiving a run plan hides it from the list"
  it("archives it and drops it from the list", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "To archive" });

    const response = await api.delete(`${BASE}/${plan.id}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: plan.id, archived: true });

    const list = (await (await api.get(BASE)).json()) as { id: string }[];
    expect(list.map((one) => one.id)).not.toContain(plan.id);
  });
});

describe("given the family's addresses", () => {
  // The family carries its version in its base path, so it is one of the four
  // the /api-and-/api/v1 twinning leaves alone: there is no bare alias and no
  // dated segment to answer on.
  it("serves the collection at /api/v1 and nowhere else", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });

    const versioned = await api.get(BASE);

    expect(versioned.status).toBe(200);
    expect(((await versioned.json()) as { id: string }[]).map((one) => one.id)).toEqual([plan.id]);
    expect((await api.get("/api/run-plans")).status).toBe(404);
    expect((await api.get(`${BASE}/2026-08-27/`)).status).toBe(404);
  });

  // @scenario "An unknown run plans version segment answers 404"
  it("answers 404 for a version segment the family never served", async () => {
    const { api } = mountSuiteFamilies();

    const response = await api.get(`${BASE}/2020-01-01/`);

    expect(response.status).toBe(404);
  });
});

/** The `langwatch` block a queued run carries its actor in. */
function langwatchMetadata(metadata: unknown): Record<string, unknown> {
  return ((metadata ?? {}) as { langwatch?: Record<string, unknown> }).langwatch ?? {};
}
