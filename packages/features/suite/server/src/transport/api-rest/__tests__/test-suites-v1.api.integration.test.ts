/**
 * @vitest-environment node
 *
 * The test suites REST family, driven through the real Hono app over the real
 * suite application.
 *
 * A TEST SUITE holds what it collects and nothing about how a run of it is
 * executed, so the targets arrive with the run request and the run is filed
 * under the run plan the scope resolves. That crossing between the two
 * families is what the suite is about, which is why both are mounted over one
 * application here.
 *
 * Every route that addresses ONE test suite is exercised here, because that is
 * where the family used to refuse itself: `readTestSuite` asks the application
 * for `kind: "test_suite"`, and the application now answers the test-suite row
 * rather than the run-plan-shaped one the suite service converts it into.
 *
 * @see specs/api-reference/test-suites-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { errorCodeOf, mountSuiteFamilies } from "./support/suite-family.harness";

const BASE = "/api/v1/test-suites";

describe("given the project holds one test suite and one run plan", () => {
  // @scenario "Listing test suites returns the test suites only"
  it("returns the test suite alone", async () => {
    const { api, world } = mountSuiteFamilies();
    const testSuite = world.addTestSuite({ name: "Refunds" });
    world.addPlan({ name: "Nightly" });

    const response = await api.get(BASE);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; scenarioCount: number; platformUrl: string }[];
    expect(body.map((one) => one.id)).toEqual([testSuite.id]);
    expect(body[0]?.scenarioCount).toBe(0);
    expect(body[0]?.platformUrl).toContain("/acme/");
  });
});

describe("given a name for a new test suite", () => {
  // @scenario "Creating a test suite creates it empty"
  it("creates it with no scenario", async () => {
    const { api } = mountSuiteFamilies();

    const response = await api.post(BASE, { name: "Refunds" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      name: "Refunds",
      scenarioIds: [],
      scenarioCount: 0,
      archivedAt: null,
    });
  });
});

describe("given a test suite holds two scenarios", () => {
  // @scenario "Reading a test suite names the scenarios filed in it"
  // @scenario "A test suite reads back with the scenarios filed in it"
  it("names both scenarios in the response", async () => {
    const { api, world } = mountSuiteFamilies();
    const { testSuite, cases } = world.addTestSuiteWithCases("Refunds", 2);

    const response = await api.get(`${BASE}/${testSuite.id}`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { scenarios: { id: string; name: string }[] };
    expect(body.scenarios.map((one) => one.id)).toEqual(cases.map((one) => one.id));
    expect(body.scenarios.map((one) => one.name)).toEqual(cases.map((one) => one.name));
  });

  // @scenario "Archiving a test suite archives the scenarios filed in it"
  it("archives the suite and the scenarios filed in it", async () => {
    const { api, world } = mountSuiteFamilies();
    const { testSuite, cases } = world.addTestSuiteWithCases("Refunds", 2);

    const response = await api.delete(`${BASE}/${testSuite.id}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: testSuite.id, archived: true });
    expect(world.testSuites.get(testSuite.id)?.archivedAt).not.toBeNull();
    for (const one of cases) expect(world.scenarios.get(one.id)?.archivedAt).not.toBeNull();
  });
});

describe("given the project holds a test suite named Refunds", () => {
  // @scenario "Renaming a test suite keeps its slug"
  it("carries the new name and the slug it was created with", async () => {
    const { api, world } = mountSuiteFamilies();
    const testSuite = world.addTestSuite({ name: "Refunds" });

    const response = await api.patch(`${BASE}/${testSuite.id}`, { name: "Returns" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "Returns",
      slug: testSuite.slug,
    });
  });
});

describe("given a test suite holds one scenario and the project holds one agent", () => {
  // @scenario "Running a test suite names the plan after the suite and its targets"
  it("creates a run plan named after the suite and the target", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const { testSuite } = world.addTestSuiteWithCases("Refunds", 1);
    // A scope naming every test suite the project holds is the same rule as
    // "all", and reads as such in the plan name, so the project holds a second.
    world.addTestSuite({ name: "Onboarding" });
    const agent = world.addAgent({ name: "dev-agent" });

    const response = await api.post(`${BASE}/${testSuite.id}/run`, {
      targets: [{ type: "http", referenceId: agent.id }],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scheduled: true,
      planName: "Refunds dev-agent",
      created: true,
    });
    expect(commands.queued).toHaveLength(1);
  });

  // @scenario "The target chosen for a test suite run is offered again from the last run plan of that suite"
  // @scenario "Running a test suite twice joins the run plan the first run resolved"
  it("reports the plan as not created the second time", async () => {
    const { api, world } = mountSuiteFamilies();
    const { testSuite } = world.addTestSuiteWithCases("Refunds", 1);
    const agent = world.addAgent({ name: "dev-agent" });
    const run = () =>
      api.post(`${BASE}/${testSuite.id}/run`, {
        targets: [{ type: "http", referenceId: agent.id }],
      });
    const first = (await (await run()).json()) as { runPlanId: string; created: boolean };
    expect(first.created).toBe(true);

    const response = await run();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      created: false,
      runPlanId: first.runPlanId,
    });
  });
});

describe("given a test suite holds active and archived scenarios", () => {
  // @scenario "Running a test suite schedules its active scenarios against the chosen targets"
  it("schedules active scenarios against every target and leaves archived ones out", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const active = [
      world.addScenario({ name: "One" }),
      world.addScenario({ name: "Two" }),
    ];
    const archived = world.addScenario({ name: "Old", archivedAt: new Date() });
    const testSuite = world.addTestSuite({
      name: "Refunds",
      scenarioIds: [active[0]!.id, active[1]!.id, archived.id],
    });
    const first = world.addAgent({ name: "first-agent" });
    const second = world.addAgent({ name: "second-agent" });

    const response = await api.post(`${BASE}/${testSuite.id}/run`, {
      targets: [
        { type: "http", referenceId: first.id },
        { type: "http", referenceId: second.id },
      ],
    });

    expect(response.status).toBe(200);
    expect(commands.queued).toHaveLength(4);
    const scheduledScenarioIds = new Set(commands.queued.map((call) => call.scenarioId));
    expect(scheduledScenarioIds).toEqual(new Set(active.map((one) => one.id)));
  });
});

describe("given a test suite whose only scenario is archived", () => {
  // @scenario "Running a test suite whose scenarios are all archived is refused with suite_scope_empty"
  it("refuses the run with suite_scope_empty and schedules nothing", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const archived = world.addScenario({ name: "Old", archivedAt: new Date() });
    const testSuite = world.addTestSuite({ name: "Refunds", scenarioIds: [archived.id] });
    const agent = world.addAgent({ name: "dev-agent" });

    const response = await api.post(`${BASE}/${testSuite.id}/run`, {
      targets: [{ type: "http", referenceId: agent.id }],
    });

    expect(response.status).toBe(422);
    await expect(errorCodeOf(response)).resolves.toBe("suite_scope_empty");
    expect(commands.queued).toHaveLength(0);
  });
});

describe("given the id names a run plan", () => {
  // @scenario "Reading a run plan through the test suite route answers suite_not_found"
  it("answers 404 naming the code", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });

    const response = await api.get(`${BASE}/${plan.id}`);

    expect(response.status).toBe(404);
    await expect(errorCodeOf(response)).resolves.toBe("suite_not_found");
  });
});

describe("given an id the project does not hold", () => {
  // @scenario "Running a test suite that does not exist answers suite_not_found"
  it("answers 404 naming the code", async () => {
    const { api, world } = mountSuiteFamilies();
    const agent = world.addAgent();

    const response = await api.post(`${BASE}/suite_nonexistent/run`, {
      targets: [{ type: "http", referenceId: agent.id }],
    });

    expect(response.status).toBe(404);
    await expect(errorCodeOf(response)).resolves.toBe("suite_not_found");
  });
});

describe("given the family's addresses", () => {
  // The family carries its version in its base path, so it is one of the four
  // the /api-and-/api/v1 twinning leaves alone: there is no bare alias and no
  // dated segment to answer on.
  it("serves the collection at /api/v1 and nowhere else", async () => {
    const { api, world } = mountSuiteFamilies();
    const testSuite = world.addTestSuite({ name: "Refunds" });

    const versioned = await api.get(BASE);

    expect(versioned.status).toBe(200);
    expect(((await versioned.json()) as { id: string }[]).map((one) => one.id)).toEqual([
      testSuite.id,
    ]);
    expect((await api.get("/api/test-suites")).status).toBe(404);
    expect((await api.get(`${BASE}/2026-08-27/`)).status).toBe(404);
  });

  // @scenario "An unknown test suites version segment answers 404"
  it("answers 404 for a version segment the family never served", async () => {
    const { api } = mountSuiteFamilies();

    const response = await api.get(`${BASE}/2020-01-01/`);

    expect(response.status).toBe(404);
  });
});
