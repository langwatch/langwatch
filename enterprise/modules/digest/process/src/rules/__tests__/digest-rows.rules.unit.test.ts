// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which rows a person's weekly email shows: each row's threshold, the priority order, the plan
 * row for admins alone, at most two regressions and five rows, and the New row last or dropped.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { describe, expect, it } from "vitest";

import {
  type DigestRowsEvaluator,
  type DigestRowsInput,
  type DigestRowsProject,
  selectDigestRows,
} from "../digest-rows.rules.ts";

const none = { total: 0, failed: 0 };

function project(overrides: Partial<DigestRowsProject> & { projectId: string }): DigestRowsProject {
  return {
    traces: 0,
    previousTraces: 0,
    scenarios: none,
    scenarioBaseline: none,
    evaluators: [],
    evaluationRuns: 0,
    ...overrides,
  };
}

/** A busy project with an eval and scenario history, so neither setup nor New shows. */
const settled = (overrides: Partial<DigestRowsProject> & { projectId: string }) =>
  project({
    traces: 1_000,
    previousTraces: 900,
    scenarios: { total: 100, failed: 10 },
    scenarioBaseline: { total: 400, failed: 40 },
    evaluationRuns: 50,
    ...overrides,
  });

function input(overrides: Partial<DigestRowsInput> = {}): DigestRowsInput {
  return {
    mode: "auto",
    admin: false,
    plan: null,
    codingAgentSessions: 0,
    projects: [],
    ...overrides,
  };
}

const kinds = (selected: ReturnType<typeof selectDigestRows>) =>
  selected?.shown.map((row) => row.kind);

/** An eval that failed `failed` of `total` this week, against `baselineFailed` of `baselineTotal`. */
function evaluator({
  evaluatorType = "ragas/faithfulness",
  total,
  failed,
  baselineTotal,
  baselineFailed,
}: {
  evaluatorType?: string;
  total: number;
  failed: number;
  baselineTotal: number;
  baselineFailed: number;
}): DigestRowsEvaluator {
  return {
    evaluatorType,
    week: { total, failed },
    baseline: { total: baselineTotal, failed: baselineFailed },
  };
}

describe("selectDigestRows()", () => {
  describe("when an admin's organization is at its plan's threshold", () => {
    /** @scenario "Only an admin near the plan limit sees the plan row, and first" */
    it("shows the plan first at 80%, and not at 79.9%", () => {
      const projects = [settled({ projectId: "p" })];
      const at = selectDigestRows(
        input({ admin: true, plan: { used: 800, limit: 1_000 }, projects }),
      );
      const below = selectDigestRows(
        input({ admin: true, plan: { used: 799, limit: 1_000 }, projects }),
      );

      expect(kinds(at)?.[0]).toBe("plan");
      expect(kinds(below)).not.toContain("plan");
    });

    /** @scenario "Only an admin near the plan limit sees the plan row, and first" */
    it("never shows it to a member, or where the plan has no limit", () => {
      const projects = [settled({ projectId: "p" })];
      const member = selectDigestRows(input({ plan: { used: 1_000, limit: 1_000 }, projects }));
      const unlimited = selectDigestRows(input({ admin: true, plan: null, projects }));

      expect(kinds(member)).not.toContain("plan");
      expect(kinds(unlimited)).not.toContain("plan");
    });
  });

  describe("when a scenario failure rate moves against its runs-weighted baseline", () => {
    /** @scenario "A move of exactly 10 points shows a row, and 9.9 does not" */
    it("shows a regression at exactly 10 points and none at 9.9", () => {
      const moved = (failed: number) =>
        selectDigestRows(
          input({
            projects: [
              settled({
                projectId: "p",
                scenarios: { total: 1_000, failed },
                scenarioBaseline: { total: 1_000, failed: 100 },
              }),
            ],
          }),
        );

      expect(moved(200)?.shown[0]).toMatchObject({ kind: "scenarios", direction: "worse" });
      expect(kinds(moved(199))).not.toContain("scenarios");
    });

    /** @scenario "A recovery shows without a button" */
    it("shows a fall of 10 points as a recovery, after the traces row", () => {
      const selected = selectDigestRows(
        input({
          projects: [
            settled({
              projectId: "p",
              scenarios: { total: 100, failed: 5 },
              scenarioBaseline: { total: 400, failed: 80 },
            }),
          ],
        }),
      );

      expect(kinds(selected)).toEqual(["traces", "scenarios"]);
      expect(selected?.shown[1]).toMatchObject({ direction: "better" });
    });

    /** @scenario "A project with no scenario history has no scenario row" */
    it("shows no scenario row without runs this week or in the four before", () => {
      const noBaseline = settled({
        projectId: "p",
        scenarios: { total: 50, failed: 50 },
        scenarioBaseline: none,
      });
      const noRunsNow = settled({ projectId: "q", scenarios: none });

      expect(kinds(selectDigestRows(input({ projects: [noBaseline, noRunsNow] })))).not.toContain(
        "scenarios",
      );
    });
  });

  describe("when an eval's pass rate moves", () => {
    /** @scenario "An eval with fewer than 20 checks this week or in its baseline has no row" */
    it("compares it only with 20 checks this week and in the baseline", () => {
      const withChecks = (total: number, baselineTotal: number) =>
        selectDigestRows(
          input({
            projects: [
              settled({
                projectId: "p",
                evaluators: [
                  evaluator({ total, failed: total / 2, baselineTotal, baselineFailed: 0 }),
                ],
              }),
            ],
          }),
        );

      expect(kinds(withChecks(20, 20))).toContain("evals");
      expect(kinds(withChecks(18, 200))).not.toContain("evals");
      expect(kinds(withChecks(200, 18))).not.toContain("evals");
    });

    /** @scenario "An eval with fewer than 20 checks this week or in its baseline has no row" */
    it("names an eval that held its rate as steady, and one with too few checks not at all", () => {
      const selected = selectDigestRows(
        input({
          projects: [
            settled({
              projectId: "p",
              evaluators: [
                evaluator({ total: 400, failed: 16, baselineTotal: 1_600, baselineFailed: 64 }),
                evaluator({
                  evaluatorType: "langevals/tone",
                  total: 10,
                  failed: 0,
                  baselineTotal: 100,
                  baselineFailed: 0,
                }),
              ],
            }),
          ],
        }),
      );

      expect(selected?.steadyEvals).toEqual([
        { evaluatorType: "ragas/faithfulness", week: { total: 400, failed: 16 } },
      ]);
    });
  });

  describe("when more than two rates got worse", () => {
    /** @scenario "At most two regressions show, biggest first, and the rest fold" */
    it("shows the two biggest moves first and folds the third", () => {
      const worse = (failed: number) => ({
        total: 100,
        failed,
        baselineTotal: 100,
        baselineFailed: 0,
      });
      const selected = selectDigestRows(
        input({
          projects: [
            settled({
              projectId: "p",
              scenarios: { total: 100, failed: 30 },
              scenarioBaseline: { total: 100, failed: 10 },
              evaluators: [
                evaluator({ evaluatorType: "a/small", ...worse(15) }),
                evaluator({ evaluatorType: "a/big", ...worse(50) }),
              ],
            }),
          ],
        }),
      );

      expect(selected?.shown.slice(0, 2)).toMatchObject([
        { kind: "evals", evaluatorType: "a/big" },
        { kind: "scenarios" },
      ]);
      expect(selected?.folded).toEqual([
        expect.objectContaining({ kind: "evals", evaluatorType: "a/small" }),
      ]);
    });
  });

  describe("when a project sent nothing this week", () => {
    /** @scenario "A project is quiet only when last week's count was read and above none" */
    it("calls it quiet only when last week was read and had traces", () => {
      const selected = selectDigestRows(
        input({
          projects: [
            settled({ projectId: "busy" }),
            project({ projectId: "went-quiet", previousTraces: 640 }),
            project({ projectId: "unread", previousTraces: null }),
            project({ projectId: "never-sent", previousTraces: 0 }),
          ],
        }),
      );

      expect(selected?.shown.filter((row) => row.kind === "quiet")).toEqual([
        { kind: "quiet", projectId: "went-quiet", previousTraces: 640 },
      ]);
    });
  });

  describe("when nothing checked the organization's traces", () => {
    /** @scenario "The setup row shows only where no eval ran on any visible project in five weeks" */
    it("asks for an eval on the busiest project, and a first scenario, last", () => {
      const selected = selectDigestRows(
        input({
          projects: [
            project({ projectId: "small", traces: 3 }),
            project({ projectId: "docs-helper", traces: 37, previousTraces: 12 }),
          ],
        }),
      );

      expect(selected?.shown).toEqual([
        { kind: "setup", projectId: "docs-helper" },
        { kind: "traces", projectId: "docs-helper" },
        { kind: "new", projectId: "docs-helper" },
      ]);
    });

    /** @scenario "The setup row shows only where no eval ran on any visible project in five weeks" */
    it("asks for none when any visible project ran an eval in the five weeks", () => {
      const selected = selectDigestRows(
        input({
          projects: [
            project({ projectId: "docs-helper", traces: 37 }),
            project({ projectId: "checked-before", evaluationRuns: 3 }),
          ],
        }),
      );

      expect(kinds(selected)).not.toContain("setup");
    });
  });

  describe("when a person ran coding agents", () => {
    /** @scenario "A coding-agent row never shows cost" */
    it("shows their row from five sessions, not at four", () => {
      const projects = [settled({ projectId: "p" })];

      expect(kinds(selectDigestRows(input({ codingAgentSessions: 5, projects })))).toContain(
        "coding",
      );
      expect(kinds(selectDigestRows(input({ codingAgentSessions: 4, projects })))).not.toContain(
        "coding",
      );
    });
  });

  describe("when more rows have something to say than the email holds", () => {
    const flooded = input({
      admin: true,
      plan: { used: 940, limit: 1_000 },
      codingAgentSessions: 64,
      projects: [
        settled({
          projectId: "checkout",
          traces: 400_000,
          scenarios: { total: 240, failed: 74 },
          scenarioBaseline: { total: 1_000, failed: 90 },
        }),
        project({ projectId: "internal-search", previousTraces: 2_140 }),
        project({ projectId: "returns", traces: 10, previousTraces: 2 }),
        project({ projectId: "claims", previousTraces: 500 }),
      ],
    });

    /** @scenario "Rows cut by the cap are named in the Also line, and a cut New row is dropped" */
    it("shows five in priority order, folds the rest and drops the New row", () => {
      const selected = selectDigestRows(flooded);

      expect(kinds(selected)).toEqual(["plan", "scenarios", "quiet", "quiet", "coding"]);
      expect(selected?.folded).toEqual([{ kind: "traces", projectId: "checkout" }]);
      expect(JSON.stringify(selected)).not.toContain('"new"');
    });

    /** @scenario "Only an admin near the plan limit sees the plan row, and first" */
    it("gives a member the traces row in the plan's place", () => {
      const selected = selectDigestRows({ ...flooded, admin: false });

      expect(kinds(selected)).toEqual(["scenarios", "quiet", "quiet", "coding", "traces"]);
      expect(selected?.folded).toEqual([]);
    });
  });

  describe("when the organization had no traces this week or last", () => {
    /** @scenario "An organization with no traces this week or last is sent nothing" */
    it("selects nothing, since only a New row could show", () => {
      const selected = selectDigestRows(
        input({ projects: [project({ projectId: "p", previousTraces: 0 })] }),
      );

      expect(selected).toEqual({ shown: [], folded: [], steadyEvals: [] });
    });
  });

  describe("when a staff test asks for every row", () => {
    /** @scenario "Staff send a person every row with data, past the thresholds" */
    it("lifts every threshold and the cap, and still keeps the plan from a member", () => {
      const every = input({
        mode: "every-row",
        admin: true,
        plan: { used: 10, limit: 1_000 },
        codingAgentSessions: 1,
        projects: [
          settled({
            projectId: "p",
            scenarios: { total: 100, failed: 11 },
            evaluators: [
              evaluator({
                evaluatorType: "a/x",
                total: 2,
                failed: 1,
                baselineTotal: 4,
                baselineFailed: 0,
              }),
              evaluator({
                evaluatorType: "a/y",
                total: 2,
                failed: 2,
                baselineTotal: 4,
                baselineFailed: 0,
              }),
            ],
          }),
          project({ projectId: "q", previousTraces: 5 }),
        ],
      });

      const admin = selectDigestRows(every);
      const member = selectDigestRows({ ...every, admin: false });

      expect(kinds(admin)).toEqual([
        "plan",
        "evals",
        "evals",
        "scenarios",
        "quiet",
        "coding",
        "traces",
      ]);
      expect(admin?.folded).toEqual([]);
      expect(kinds(member)?.[0]).toBe("evals");
    });
  });
});
