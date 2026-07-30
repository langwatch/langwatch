/**
 * Unit tests for what the report says about what it did not cover.
 *
 * The run record does not carry the suite's roster, so this question can only
 * honestly speak about scenarios it has seen run before. These tests exist
 * mostly to stop it drifting back into claiming full coverage, which would be
 * asserting something the data cannot support.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { describe, expect, it } from "vitest";
import { evidenceFixture } from "../../__tests__/evidence-fixture";
import type { Block } from "../../report.types";
import { QUESTION_REGISTRY } from "../question-registry";

const coverage = QUESTION_REGISTRY.find(
  (question) => question.id === "present.coverage",
)!;

function textOf(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "note") return block.text;
      if (block.kind === "list")
        return block.items.map((item) => item.text).join(" ");
      return "";
    })
    .join(" ");
}

describe("the coverage question", () => {
  describe("given a scenario that ran before and not this time", () => {
    /** @scenario The report says what was not attempted */
    it("names it as unattempted", () => {
      const blocks = coverage.computed(
        evidenceFixture({
          coverage: {
            scenariosInSuite: [{ scenarioId: "scen_1", name: "Refund" }],
            scenariosNotRun: [{ scenarioId: "scen_9", name: "Chargeback" }],
            neverFailed: [],
          },
          priorBatches: [
            { batchRunId: "batch_0", startedAt: 1, passRate: 100, settled: 2 },
          ],
        }),
      );

      expect(textOf(blocks)).toContain("Chargeback");
    });
  });

  describe("given a run that covered everything seen before", () => {
    /** @scenario A run that covered everything says so */
    it("says so without claiming knowledge of scenarios it has never seen", () => {
      const blocks = coverage.computed(
        evidenceFixture({
          priorBatches: [
            { batchRunId: "batch_0", startedAt: 1, passRate: 100, settled: 2 },
          ],
        }),
      );
      const text = textOf(blocks);

      expect(text).toContain("every one of the");
      expect(text).toContain("previous runs");
      // The suite roster is unknown, so this claim must never be made.
      expect(text).not.toContain("nothing was left unattempted");
    });
  });

  describe("given the first run of a suite", () => {
    it("declines to say anything about what was skipped", () => {
      const blocks = coverage.computed(evidenceFixture({ priorBatches: [] }));

      expect(textOf(blocks)).toContain("nothing to say about what it might");
    });
  });
});

describe("the failure-grouping question", () => {
  describe("given a group spanning two scenarios that failed the same way", () => {
    // The group keeps each scenario's own criterion id so a claim can cite the
    // exact one, which means the same wording arrives more than once.
    it("names the criterion once rather than repeating it as a second failure", () => {
      const clusters = QUESTION_REGISTRY.find(
        (question) => question.id === "present.clusters",
      )!;
      const blocks = clusters.computed(
        evidenceFixture({
          criteria: [
            {
              criterionId: "c_a",
              scenarioId: "scen_1",
              text: "stays on topic",
              metCount: 0,
              unmetCount: 1,
              metRunIds: [],
              unmetRunIds: ["run_1"],
            },
            {
              criterionId: "c_b",
              scenarioId: "scen_2",
              text: "stays on topic",
              metCount: 0,
              unmetCount: 1,
              metRunIds: [],
              unmetRunIds: ["run_2"],
            },
          ],
          signatures: [
            {
              signatureId: "s_shared",
              kind: "judged",
              unmetCriterionIds: ["c_a", "c_b"],
              errorShape: null,
              errorExample: null,
              runIds: ["run_1", "run_2"],
              scenarioIds: ["scen_1", "scen_2"],
            },
          ],
        }),
      );
      const group =
        blocks[0]?.kind === "groups" ? blocks[0].groups[0] : undefined;

      expect(group?.title).toBe("stays on topic");
      expect(group?.detail.some((it) => it.label === "Also failed")).toBe(
        false,
      );
    });
  });

  describe("given several groups that all errored", () => {
    const clusters = QUESTION_REGISTRY.find(
      (question) => question.id === "present.clusters",
    )!;

    function erroredGroupTitles(errors: string[]): (string | undefined)[] {
      const blocks = clusters.computed(
        evidenceFixture({
          signatures: errors.map((error, index) => ({
            signatureId: `s_${index}`,
            kind: "errored" as const,
            unmetCriterionIds: [],
            errorShape: "<shape>",
            errorExample: error,
            runIds: [`run_${index}`],
            scenarioIds: [`scen_${index}`],
          })),
        }),
      );
      return blocks[0]?.kind === "groups"
        ? blocks[0].groups.map((group) => group.title)
        : [];
    }

    /**
     * An errored run has no criterion to be named by, so without this every
     * error group carries one title and the rows read as duplicates.
     *
     * @scenario Infrastructure errors are separated from judged failures
     */
    it("tells them apart by their error", () => {
      const titles = erroredGroupTitles([
        "AI_APICallError: content was flagged",
        "Attacker model returned no content",
      ]);

      expect(new Set(titles).size).toBe(2);
      expect(titles[0]).toContain("content was flagged");
      expect(titles[1]).toContain("Attacker model returned no content");
    });

    /**
     * Errors name methods, and ending the heading at the first dot cuts it
     * before the part that says what went wrong.
     *
     * @scenario Infrastructure errors are separated from judged failures
     */
    it("does not end the heading inside a dotted method name", () => {
      const [title] = erroredGroupTitles([
        "Error: Langy langy.continueConversation -> 409 conflict",
      ]);

      expect(title).toContain("langy.continueConversation");
    });
  });
});
