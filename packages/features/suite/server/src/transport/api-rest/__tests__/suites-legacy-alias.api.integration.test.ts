/**
 * @vitest-environment node
 * @see specs/api-reference/suites-legacy-alias.feature
 */
import { describe, expect, it } from "vitest";

import { errorCodeOf, mountSuiteFamilies } from "./support/suite-family.harness";

const BASE = "/api/suites";

describe("given both addresses the alias answers on", () => {
  it("answers the bare alias identically to /api/v1", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });

    const bare = await api.get(BASE);
    const versioned = await api.get("/api/v1/suites");

    expect(bare.status).toBe(200);
    expect(versioned.status).toBe(bare.status);
    const bareBody = (await bare.json()) as { id: string }[];
    expect(bareBody.map((one) => one.id)).toEqual([plan.id]);
    await expect(versioned.json()).resolves.toEqual(bareBody);
  });
});

describe("given the project holds one run plan", () => {
  // @scenario "Every suites response carries the deprecation headers"
  it("names its successor on every endpoint of the family", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });

    for (const response of [await api.get(BASE), await api.get(`${BASE}/${plan.id}`)]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Link")).toBe('</api/v1/run-plans>; rel="successor-version"');
    }
  });

  // @scenario "Running a run plan through the alias with targets answers validation_error"
  it("refuses a run body naming targets", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });

    const response = await api.post(`${BASE}/${plan.id}/run`, {
      targets: [{ type: "http", referenceId: world.addAgent().id }],
    });

    expect(response.status).toBe(422);
    await expect(errorCodeOf(response)).resolves.toBe("validation_error");
    expect(commands.queued).toHaveLength(0);
  });
});

describe("given a suite id the project does not hold", () => {
  // @scenario "A refused suites request still carries the deprecation headers"
  it("names its successor on the refusal too", async () => {
    const { api } = mountSuiteFamilies();

    const response = await api.get(`${BASE}/suite_nonexistent`);

    expect(response.status).toBe(404);
    expect(response.headers.get("Deprecation")).toBe("true");
  });
});

describe("given the project holds a test suite with one scenario", () => {
  // @scenario "Running a test suite through the alias takes its targets from the body"
  it("schedules the runs and creates the run plan the suite and target name", async () => {
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

  // @scenario "Running a test suite through the alias with no target answers suite_targets_required"
  it("refuses a run that names no target", async () => {
    const { api, world, commands } = mountSuiteFamilies();
    const { testSuite } = world.addTestSuiteWithCases("Refunds", 1);

    const response = await api.post(`${BASE}/${testSuite.id}/run`, {});

    expect(response.status).toBe(400);
    await expect(errorCodeOf(response)).resolves.toBe("suite_targets_required");
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(commands.queued).toHaveLength(0);
  });
});

describe("given the project holds one test suite", () => {
  // @scenario "Updating a test suite through the alias with targets answers validation_error"
  it("refuses an update body naming targets", async () => {
    const { api, world } = mountSuiteFamilies();
    const testSuite = world.addTestSuite({ name: "Refunds" });

    const response = await api.patch(`${BASE}/${testSuite.id}`, {
      targets: [{ type: "http", referenceId: world.addAgent().id }],
    });

    expect(response.status).toBe(422);
    await expect(errorCodeOf(response)).resolves.toBe("validation_error");
    expect(world.testSuites.get(testSuite.id)?.targets).toEqual([]);
  });
});
