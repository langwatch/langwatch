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
 * Six scenarios of the spec are NOT bound here, and deliberately: every route
 * that addresses ONE test suite refuses it. `readTestSuite` requires
 * `getByIdOrTestSuite` to answer `kind: "test_suite"`, and it never can — the
 * suite service's own `tryGet` falls back to the test-suite store and answers
 * `kind: "suite"` carrying a `test_suite` row, so read, rename, archive and run
 * all answer 404 suite_not_found. That is a production defect, reported rather
 * than pinned; a test asserting today's 404 would lock the bug in.
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
