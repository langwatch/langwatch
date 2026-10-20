import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classify,
  collectOutcomes,
  FILE_DID_NOT_RUN,
  newlyFlaky,
  renderFlaky,
  type FlakyReport,
  type SuiteRun,
} from "./nightly-flaky.ts";
import { parseReportFileName, reportFileName, vitestArgsFor } from "./run-package-suites.ts";

const root = "/home/runner/work/repo/repo";

const run = (
  seed: string,
  tests: Record<string, string>,
  file = "packages/a/src/a.test.ts",
): SuiteRun => ({
  seed,
  pkg: "@langwatch/a",
  script: "test",
  report: {
    testResults: [
      {
        name: `${root}/${file}`,
        status: "passed",
        assertionResults: Object.entries(tests).map(([fullName, status]) => ({ fullName, status })),
      },
    ],
  },
});

const reportOf = (runs: SuiteRun[]): FlakyReport => ({
  date: "2026-10-20",
  commit: "0123456789abcdef",
  seeds: ["11", "12", "13"],
  ...classify({ outcomes: collectOutcomes({ runs, root }) }),
  missing: [],
});

void describe("given three shuffled runs of a package suite", () => {
  void describe("when a test fails with one seed and passes with the others", () => {
    /** @scenario "A test that failed in some runs and passed in others is flaky, with its seeds" */
    void it("lists it as flaky with the failing seed and a rerun command", () => {
      const report = reportOf([
        run("11", { "a when b passes": "passed" }),
        run("12", { "a when b passes": "failed" }),
        run("13", { "a when b passes": "passed" }),
      ]);
      assert.equal(report.flaky.length, 1);
      assert.deepEqual(report.flaky[0]?.failedSeeds, ["12"]);
      assert.equal(report.flaky[0]?.file, "packages/a/src/a.test.ts");
      assert.match(
        renderFlaky({ report, fresh: [], baseline: false }),
        /pnpm --filter @langwatch\/a run test --sequence\.shuffle --sequence\.seed=12/,
      );
    });
  });

  void describe("when a test fails every time", () => {
    /** @scenario "A test that failed every run is failing, not flaky" */
    void it("lists it as failing and not as flaky", () => {
      const report = reportOf(
        ["11", "12", "13"].map((seed) => run(seed, { broken: "failed", fine: "passed" })),
      );
      assert.deepEqual(report.flaky, []);
      assert.deepEqual(
        report.failing.map((item) => item.test),
        ["broken"],
      );
    });
  });

  void describe("when a file fails to load in one run only", () => {
    /** @scenario "A test file that failed to load counts as a failure of that file" */
    void it("lists the file as flaky", () => {
      const broken: SuiteRun = {
        seed: "12",
        pkg: "@langwatch/a",
        script: "test",
        report: {
          testResults: [
            { name: `${root}/packages/a/src/a.test.ts`, status: "failed", assertionResults: [] },
          ],
        },
      };
      const report = reportOf([run("11", { only: "passed" }), broken]);
      assert.deepEqual(
        report.flaky.map((item) => [item.test, item.failedSeeds, item.passedSeeds]),
        [[FILE_DID_NOT_RUN, ["12"], ["11"]]],
      );
      assert.deepEqual(report.failing, []);
    });
  });
});

void describe("given last night's flaky tests", () => {
  void describe("when tonight has the same one and another", () => {
    /** @scenario "A newly flaky test goes red, one already flaky last night does not" */
    void it("reports only the other one as new", () => {
      const both = reportOf([
        run("11", { old: "passed", fresh: "failed" }),
        run("12", { old: "failed", fresh: "passed" }),
      ]);
      const lastNight = reportOf([run("11", { old: "passed" }), run("12", { old: "failed" })]);
      assert.deepEqual(
        newlyFlaky({ previous: lastNight, current: both }).map((item) => item.test),
        ["fresh"],
      );
      assert.deepEqual(newlyFlaky({ previous: null, current: both }), []);
    });
  });
});

void describe("given the package suite runner in the hunt", () => {
  const extra = ["--sequence.shuffle", "--sequence.seed=12"];

  void describe("when a script ends in vitest run", () => {
    /** @scenario "The suite runner shuffles only scripts that end in vitest" */
    void it("passes the shuffle and a JSON report, and skips other scripts", () => {
      assert.deepEqual(
        vitestArgsFor({ body: "vitest run --passWithNoTests", extra, reportFile: "/r/a.json" }),
        [...extra, "--reporter=default", "--reporter=json", "--outputFile.json=/r/a.json"],
      );
      assert.deepEqual(
        vitestArgsFor({
          body: "playwright install --with-deps chromium && vitest run --config vitest.browser.config.ts",
          extra,
        }),
        extra,
      );
      assert.equal(vitestArgsFor({ body: "playwright test", extra }), undefined);
      assert.equal(vitestArgsFor({ body: "nx run-many -t test", extra }), undefined);
    });
  });

  void describe("when a report is named", () => {
    /** @scenario "A suite's report name says which package and script to rerun" */
    void it("has no colon and reads back as the same package and script", () => {
      const name = reportFileName({ pkg: "@langwatch/trace_process", script: "test:integration" });
      assert.equal(name.includes(":"), false);
      assert.deepEqual(parseReportFileName(name), {
        pkg: "@langwatch/trace_process",
        script: "test:integration",
      });
    });
  });
});
