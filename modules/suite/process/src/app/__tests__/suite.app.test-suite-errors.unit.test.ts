/**
 * @vitest-environment node
 */
import { ScenarioTestSuiteNotFoundError, type ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { createSuiteTestApp } from "./suite.fixture.ts";

describe("SuiteApp test-suite mutations", () => {
  /** @scenario "Renaming a missing suite reports the suite error" */
  it("translates a missing scenario test suite while renaming at the app boundary", async () => {
    const renameTestSuite = vi
      .fn<ScenarioApi["renameTestSuite"]>()
      .mockRejectedValue(new ScenarioTestSuiteNotFoundError("test_suite_missing"));
    const app = createSuiteTestApp({
      dependencies: {
        scenarios: createApiFixture<ScenarioApi>({ renameTestSuite }),
      },
    });

    await expect(
      app.renameTestSuite({
        projectId: "project_1",
        testSuiteId: "test_suite_missing",
        name: "Renamed",
      }),
    ).rejects.toMatchObject({
      code: "suite_not_found",
      httpStatus: 404,
      meta: { id: "test_suite_missing" },
    });
  });

  /** @scenario "Archiving a missing suite reports the suite error" */
  it("translates a missing scenario test suite while archiving at the app boundary", async () => {
    const archiveTestSuite = vi
      .fn<ScenarioApi["archiveTestSuite"]>()
      .mockRejectedValue(new ScenarioTestSuiteNotFoundError("test_suite_missing"));
    const app = createSuiteTestApp({
      dependencies: {
        scenarios: createApiFixture<ScenarioApi>({ archiveTestSuite }),
      },
    });

    await expect(
      app.archiveTestSuite({ projectId: "project_1", testSuiteId: "test_suite_missing" }),
    ).rejects.toMatchObject({
      code: "suite_not_found",
      httpStatus: 404,
      meta: { id: "test_suite_missing" },
    });
  });
});
