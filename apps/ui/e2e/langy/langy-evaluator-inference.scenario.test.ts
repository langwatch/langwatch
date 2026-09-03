/**
 * The evaluator-inference branches of the prompt optimization skill: Langy
 * reads what the dataset holds and wires the evaluator that measures it.
 * Judge-graded, and the evaluator that actually landed is then asserted
 * through the workbench-state REST surface: its type AND its mappings.
 *
 * RUN (one file per vitest run, see README):
 *   cd apps/ui/e2e/langy && npx vitest run langy-evaluator-inference.scenario.test.ts --reporter=verbose
 */

import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { LANGY_EVALUATOR_INFERENCE_CRITERIA } from "./langy-rules";
import {
  expectEvaluatorWiring,
  runBootstrapScenario,
  seedWithoutEvaluator,
} from "./optimization-bootstrap-harness";
import { getWorkbenchState } from "./seed-optimization-workbench";

describe("Langy prompt optimization: choosing the evaluator from the data", () => {
  describe("when the golden answers are short labels", () => {
    /** @scenario Classification-like golden answers get exact match on the golden column */
    it("wires exact match to the golden column", async () => {
      const seeded = await seedWithoutEvaluator({
        name: "bootstrap-labels",
        rows: 20,
        goldenStyle: "label",
      });
      const result = await runBootstrapScenario({
        name: "classification goldens get exact match",
        description:
          "The dataset's expected outputs are single-word categories from a small set. The user wants to know how accurate the classifier prompt is. The right evaluator is exact match on the golden column.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `add scoring to my "${seeded.experimentSlug}" experiment. it's a category classifier, I want accuracy`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: LANGY_EVALUATOR_INFERENCE_CRITERIA,
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await getWorkbenchState(seeded.experimentSlug);
      expectEvaluatorWiring({
        evaluators: after.state.evaluators,
        datasetId: seeded.datasetId,
        targetId: seeded.baselineTargetId,
        isWanted: (type) => type === "langevals/exact_match",
        wiring: {
          output: { from: "target", output: "output" },
          expected_output: { from: "dataset", column: "expected_output" },
        },
        what: "no exact-match evaluator reads the prompt column's output against the golden column",
      });
    });
  });

  describe("when the golden answers are free text", () => {
    /** @scenario Free-text golden answers get the LLM answer match evaluator */
    it("wires the LLM answer match evaluator", async () => {
      const seeded = await seedWithoutEvaluator({
        name: "bootstrap-freetext",
        rows: 20,
        goldenStyle: "free-text",
      });
      const result = await runBootstrapScenario({
        name: "free-text goldens get llm answer match",
        description:
          "The dataset's expected outputs are full support replies. The user asks how to measure whether the bot's answers are right. The right evaluator judges answer match against the golden, with input, output and expected output wired.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `how do I measure if the answers in "${seeded.experimentSlug}" are actually right? set it up for me`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: LANGY_EVALUATOR_INFERENCE_CRITERIA,
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await getWorkbenchState(seeded.experimentSlug);
      expectEvaluatorWiring({
        evaluators: after.state.evaluators,
        datasetId: seeded.datasetId,
        targetId: seeded.baselineTargetId,
        isWanted: (type) => type === "langevals/llm_answer_match",
        wiring: {
          input: { from: "dataset", column: "input" },
          output: { from: "target", output: "output" },
          expected_output: { from: "dataset", column: "expected_output" },
        },
        what: "no answer-match evaluator reads the question, the prompt column's output and the golden column",
      });
    });
  });

  describe("when the dataset carries a contexts column", () => {
    /** @scenario A contexts column gets faithfulness with contexts wired */
    it("brings up faithfulness and wires the contexts field", async () => {
      const seeded = await seedWithoutEvaluator({
        name: "bootstrap-contexts",
        rows: 20,
        goldenStyle: "free-text",
        withContexts: true,
      });
      const result = await runBootstrapScenario({
        name: "contexts column suggests faithfulness",
        description:
          "The dataset has a contexts column: this is a RAG bot and the user cares that answers stick to the retrieved context. The evaluator choice must involve faithfulness with the contexts field wired.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `"${seeded.experimentSlug}" is my RAG support bot. I care that answers stick to the retrieved context, set up scoring for that`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: LANGY_EVALUATOR_INFERENCE_CRITERIA,
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await getWorkbenchState(seeded.experimentSlug);
      expectEvaluatorWiring({
        evaluators: after.state.evaluators,
        datasetId: seeded.datasetId,
        targetId: seeded.baselineTargetId,
        isWanted: (type) => type.includes("faithfulness"),
        wiring: {
          output: { from: "target", output: "output" },
          contexts: { from: "dataset", column: "contexts" },
        },
        what: "no faithfulness evaluator reads the prompt column's output against the contexts column",
      });
    });
  });

  describe("when the user names a quality dimension and has no goldens", () => {
    /** @scenario A named quality dimension with no golden gets a judge evaluator naming that dimension */
    it("proposes a judge whose prompt names exactly that dimension", async () => {
      const seeded = await seedWithoutEvaluator({
        name: "bootstrap-judge",
        rows: 20,
        goldenStyle: "none",
      });
      const result = await runBootstrapScenario({
        name: "a named quality dimension gets a judge",
        description:
          "The dataset has inputs only. The user wants replies to be more polite while staying correct. The right evaluator is an LLM judge (boolean or score) whose prompt names politeness.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `I don't have right answers written down for "${seeded.experimentSlug}". I just want the replies to be more polite but still correct. how do we score that?`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: LANGY_EVALUATOR_INFERENCE_CRITERIA,
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await getWorkbenchState(seeded.experimentSlug);
      expectEvaluatorWiring({
        evaluators: after.state.evaluators,
        datasetId: seeded.datasetId,
        targetId: seeded.baselineTargetId,
        isWanted: (type) =>
          type === "langevals/llm_boolean" ||
          type === "langevals/llm_score" ||
          type === "langevals/llm_category",
        // A judge grades the reply, so the output is the one input it cannot
        // work without. Whether it also needs the question depends on the
        // judge prompt, so only the output is required here.
        wiring: { output: { from: "target", output: "output" } },
        what: "no judge evaluator reads the prompt column's output",
      });
    });
  });

  describe("when there is no golden answer at all", () => {
    /** @scenario No golden answer at all gets a comparison between baseline and candidate */
    it("sets up the comparison judge between baseline and candidate without a golden", async () => {
      const seeded = await seedWithoutEvaluator({
        name: "bootstrap-compare",
        rows: 20,
        goldenStyle: "none",
      });
      const result = await runBootstrapScenario({
        name: "no goldens means a comparison judge",
        description:
          "Inputs only, no golden answers, and the user just wants whichever answer is better to win. The right setup duplicates the baseline and adds the comparison judge over the two columns, configured without a golden answer.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `improve the prompt in "${seeded.experimentSlug}". I have no golden answers, just pick whichever answer is better`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: LANGY_EVALUATOR_INFERENCE_CRITERIA,
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2: a comparison exists over at least two variants with the
      // golden requirement off, either as a column target or a grading entry.
      // Any one entry proves it, so the search runs over the whole list: an
      // unrelated comparison sitting earlier is not this scenario's subject.
      const after = await getWorkbenchState(seeded.experimentSlug);
      const comparisons = [
        ...after.state.targets.map((target) => target.comparison),
        ...after.state.evaluators.map((evaluator) => evaluator.comparison),
      ].filter(Boolean) as Array<{
        variants: string[];
        hasGoldenAnswer?: boolean;
      }>;
      const goldenFree = comparisons.find(
        (comparison) =>
          comparison.variants.length >= 2 &&
          comparison.hasGoldenAnswer === false,
      );
      expect(
        goldenFree,
        `no comparison over two or more variants with hasGoldenAnswer false. Comparisons found: ${JSON.stringify(comparisons)}`,
      ).toBeDefined();
    });
  });
});
