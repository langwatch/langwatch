import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickArtifact, type ArtifactRecord } from "./nightly-artifacts.ts";
import { failedJobs, jobOutcomes, JOBS, renderNightlyDashboard } from "./nightly-dashboard.ts";
import { renderUpgradeCell, upgradeLabFailure } from "./nightly-upgrade-lab.ts";

const allPassed = Object.fromEntries(JOBS.map((job) => [job.id, { result: "success" }]));

void describe("given tonight's nightly jobs", () => {
  void describe("when the dashboard is written", () => {
    /** @scenario "The dashboard shows every nightly job with tonight's outcome" */
    void it("has a row per job, then each section, and says when a job ran but left nothing", () => {
      const jobs = jobOutcomes({
        needs: { ...allPassed, "gateway-matrix": { result: "failure" } },
      });
      const body = renderNightlyDashboard({
        date: "2026-10-20",
        commit: "0123456789abcdef",
        runUrl: "https://example/run/1",
        jobs,
        sections: ["## Hygiene and lint\n\nfine\n"],
        regressionIssues: [],
      });
      assert.equal(jobs.length, JOBS.length);
      for (const job of JOBS) assert.match(body, new RegExp(`\\| ${job.title} \\|`));
      assert.match(body, /\| AI Gateway provider matrix \| \*\*failed\*\* \|/);
      assert.match(body, /## Hygiene and lint\n\nfine/);
      assert.equal(jobOutcomes({ needs: {} })[0]?.result, "not run");
    });
  });

  void describe("when the sections are too long for an issue", () => {
    /** @scenario "A dashboard too long for an issue is cut, never refused" */
    void it("cuts every section to its share at a line boundary and says so", () => {
      const long = (title: string) =>
        [
          `## ${title}`,
          ...Array.from({ length: 400 }, (_, index) => `| row ${index} | value |`),
        ].join("\n");
      const body = renderNightlyDashboard({
        date: "2026-10-20",
        commit: "0123456789abcdef",
        runUrl: "https://example/run/1",
        jobs: jobOutcomes({ needs: allPassed }),
        sections: [long("One"), long("Two")],
        regressionIssues: [],
        limit: 6_000,
      });
      assert.ok(body.length <= 6_000);
      assert.match(body, /## One/);
      assert.match(body, /## Two/);
      assert.equal(body.match(/Cut to fit the issue/g)?.length, 2);
      assert.doesNotMatch(body, /\| row \d+ \| val\n/);
    });
  });

  void describe("when some jobs failed", () => {
    /** @scenario "A failed nightly job is raised as a regression issue" */
    void it("lists only the failed jobs", () => {
      const jobs = jobOutcomes({
        needs: {
          ...allPassed,
          "hygiene-report": { result: "failure" },
          "gateway-matrix": { result: "failure" },
          "upgrade-lab": { result: "cancelled" },
          "flaky-report": { result: "skipped" },
        },
      });
      assert.deepEqual(failedJobs({ jobs }), [
        { metric: "Hygiene and lint" },
        { metric: "AI Gateway provider matrix" },
      ]);
    });
  });
});

void describe("given an upgrade lab cell", () => {
  void describe("when an invariant did not pass", () => {
    /** @scenario "The upgrade lab's section shows the cell's verdict and what did not pass" */
    void it("names the release, the verdict and the failing invariant, or the missing report", () => {
      const section = renderUpgradeCell({
        cell: "cloud-S-typical-1",
        exitCode: 1,
        report: {
          release: "main@abc1234",
          headCommit: "0123456789abcdef",
          verdicts: [
            { id: "I1", name: "no request lost", result: "pass" },
            { id: "I7", name: "worker drains", result: "fail", detail: "3 jobs | left" },
          ],
        },
      });
      assert.match(section, /From `main@abc1234` to head `0123456789`: an invariant did not pass/);
      assert.match(section, /1 of 2 invariants passed/);
      assert.match(section, /\| I7 worker drains \| fail \| 3 jobs \\\| left \|/);
      assert.match(
        renderUpgradeCell({ cell: "c", exitCode: 2, report: null }),
        /No report\.json \(exit 2\).*job log/,
      );
    });
  });

  void describe("when only invariants known to fail on a hosted runner did not pass", () => {
    /** @scenario "Only an invariant outside the hosted runner's known failures turns the upgrade lab red" */
    void it("stays green for B1 and N4, and goes red for any other failure or no verdict", () => {
      const report = (failing: string[]) => ({
        verdicts: [
          { id: "I1", name: "no request lost", result: "pass" },
          { id: "I5", name: "read models", result: "inconclusive" },
          ...failing.map((id) => ({ id, name: id, result: "fail" })),
        ],
      });
      const knownFailing = ["B1", "N4"];
      assert.equal(
        upgradeLabFailure({ exitCode: 1, report: report(["B1", "N4"]), knownFailing }),
        undefined,
      );
      assert.match(
        renderUpgradeCell({ cell: "c", exitCode: 1, report: report(["B1", "N4"]) }),
        /\| B1 B1 \| fail \|[\s\S]*\| N4 N4 \| fail \|/,
      );
      assert.equal(
        upgradeLabFailure({ exitCode: 1, report: report(["B1", "I7"]), knownFailing }),
        "I7 did not pass",
      );
      assert.match(
        upgradeLabFailure({ exitCode: 2, report: report([]), knownFailing }) ?? "",
        /before it could judge/,
      );
      assert.notEqual(upgradeLabFailure({ exitCode: 1, report: null, knownFailing }), undefined);
    });
  });
});

void describe("given artifacts from earlier nights", () => {
  const now = new Date("2026-10-20T01:30:00Z");
  const artifact = (
    id: number,
    created: string,
    extra: Partial<ArtifactRecord> = {},
  ): ArtifactRecord => ({
    id,
    name: "codebase-health",
    expired: false,
    created_at: created,
    workflow_run: { id: id * 10, head_branch: "main" },
    ...extra,
  });
  const artifacts = [
    artifact(1, "2026-10-20T01:20:00Z", { workflow_run: { id: 99, head_branch: "main" } }),
    artifact(2, "2026-10-19T01:20:00Z"),
    artifact(3, "2026-10-18T09:00:00Z", { workflow_run: { id: 30, head_branch: "feat/x" } }),
    artifact(4, "2026-10-14T01:20:00Z"),
    artifact(5, "2026-10-13T01:20:00Z", { expired: true }),
    artifact(6, "2026-09-20T01:20:00Z"),
  ];

  void describe("when one at least six days old is asked for", () => {
    /** @scenario "The comparison picks the newest default-branch artifact old enough" */
    void it("chooses the newest default-branch one that old, never tonight's, a branch's or an expired one", () => {
      const pick = (minAgeDays: number) =>
        pickArtifact({ artifacts, minAgeDays, now, excludeRunId: 99, branch: "main" })?.id;
      assert.equal(pick(0), 2);
      assert.equal(pick(6), 4);
      assert.equal(pick(29), 6);
      assert.equal(pick(60), undefined);
    });
  });
});
