/**
 * The bootstrap branches of the prompt optimization skill: a workbench
 * missing its dataset or its evaluator, and Langy inferring the right piece
 * from what the data shows. Judge-graded, with the evaluator or dataset that
 * actually landed asserted through the workbench-state REST surface.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-optimization-bootstrap.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_CORE_RULE_CRITERIA,
  LANGY_EVALUATOR_INFERENCE_CRITERIA,
} from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";
import {
  type GoldenStyle,
  getWorkbenchState,
  seedOptimizationWorkbench,
} from "./seed-optimization-workbench";

const model = openai("gpt-5-mini");

async function runBootstrapScenario({
  name,
  description,
  slug,
  script,
  criteria,
}: {
  name: string;
  description: string;
  slug: string;
  script: Parameters<typeof runScenarioAndLog>[0]["script"];
  criteria: string[];
}) {
  return runScenarioAndLog({
    name,
    description: `${description} The experiment's slug is "${slug}".`,
    agents: [
      makeLangyAdapter(),
      scenario.userSimulatorAgent({ model }),
      scenario.judgeAgent({ model, criteria }),
    ],
    script,
  });
}

async function seed({
  name,
  rows,
  goldenStyle,
  withContexts = false,
}: {
  name: string;
  rows: number;
  goldenStyle: GoldenStyle;
  withContexts?: boolean;
}) {
  return seedOptimizationWorkbench({
    name,
    rows,
    goldenStyle,
    withEvaluator: false,
    withContexts,
  });
}

describe("Langy prompt optimization: bootstrapping the missing pieces", () => {
  describe("when there is a prompt but no data", () => {
    /** @scenario With a prompt but no dataset, Langy offers to generate an example dataset */
    /** @scenario The generated bootstrap dataset is sized for iteration and matches the bot's real users */
    /** @scenario The evaluator slug comes from evaluator types, never from memory */
    it("offers a generated dataset, previews it, and lands 15 to 25 realistic rows", async () => {
      const seeded = await seed({
        name: "bootstrap-empty",
        rows: 0,
        goldenStyle: "free-text",
      });
      const result = await runBootstrapScenario({
        name: "bootstrap with an empty dataset",
        description:
          "The experiment has a webshop support prompt and an empty dataset. The user was told to test the prompt but has no data. Langy must offer to generate an example dataset, preview rows before adding them all, size it for iteration, and wire an evaluator whose slug it read from the catalog.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `someone told me I should test the prompt in "${seeded.experimentSlug}" but there's no data in there. help`,
          ),
          scenario.agent(),
          scenario.user("yes, generate it, that plan sounds fine"),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: [
          "Langy offers to generate an example dataset before any improvement work, and previews a handful of rows before adding them all.",
          "The generated rows read like this webshop support bot's real customers (order numbers, refunds, shipping, complaints), never trivia or textbook questions.",
          ...LANGY_EVALUATOR_INFERENCE_CRITERIA,
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2: the rows really landed, sized for iteration.
      const after = await getWorkbenchState(seeded.experimentSlug);
      const records = after.state.datasets[0]?.inline?.records ?? {};
      const rowCount = records.input?.length ?? 0;
      expect(rowCount).toBeGreaterThanOrEqual(15);
      expect(rowCount).toBeLessThanOrEqual(25);
    });
  });

  describe("when the golden answers are short labels", () => {
    /** @scenario Classification-like golden answers get exact match on the golden column */
    it("wires exact match to the golden column", async () => {
      const seeded = await seed({
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
      expect(
        after.state.evaluators.some(
          (e) => e.evaluatorType === "langevals/exact_match",
        ),
      ).toBe(true);
    });
  });

  describe("when the golden answers are free text", () => {
    /** @scenario Free-text golden answers get the LLM answer match evaluator */
    it("wires the LLM answer match evaluator", async () => {
      const seeded = await seed({
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
      expect(
        after.state.evaluators.some(
          (e) => e.evaluatorType === "langevals/llm_answer_match",
        ),
      ).toBe(true);
    });
  });

  describe("when the dataset carries a contexts column", () => {
    /** @scenario A contexts column gets faithfulness with contexts wired */
    it("brings up faithfulness and wires the contexts field", async () => {
      const seeded = await seed({
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
      expect(
        after.state.evaluators.some((e) =>
          e.evaluatorType.includes("faithfulness"),
        ),
      ).toBe(true);
    });
  });

  describe("when the user names a quality dimension and has no goldens", () => {
    /** @scenario A named quality dimension with no golden gets a judge evaluator naming that dimension */
    it("proposes a judge whose prompt names exactly that dimension", async () => {
      const seeded = await seed({
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
      expect(
        after.state.evaluators.some(
          (e) =>
            e.evaluatorType === "langevals/llm_boolean" ||
            e.evaluatorType === "langevals/llm_score" ||
            e.evaluatorType === "langevals/llm_category",
        ),
      ).toBe(true);
    });
  });

  describe("when there is no golden answer at all", () => {
    /** @scenario No golden answer at all gets a comparison between baseline and candidate */
    it("sets up the comparison judge between baseline and candidate without a golden", async () => {
      const seeded = await seed({
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
      const after = await getWorkbenchState(seeded.experimentSlug);
      const comparisons = [
        ...after.state.targets.map((t) => t.comparison),
        ...after.state.evaluators.map(
          (e) =>
            (
              e as {
                comparison?: { variants: string[]; hasGoldenAnswer?: boolean };
              }
            ).comparison,
        ),
      ].filter(Boolean) as Array<{
        variants: string[];
        hasGoldenAnswer?: boolean;
      }>;
      expect(comparisons.length).toBeGreaterThan(0);
      expect(comparisons[0]!.variants.length).toBeGreaterThanOrEqual(2);
      expect(comparisons[0]!.hasGoldenAnswer).toBe(false);
    });
  });

  describe("when the goal is ambiguous", () => {
    /** @scenario An ambiguous goal is asked as a choices card before anything changes */
    it("asks with a choices card and changes nothing until the answer", async () => {
      const seeded = await seed({
        name: "bootstrap-ambiguous",
        rows: 20,
        goldenStyle: "free-text",
      });
      const before = await getWorkbenchState(seeded.experimentSlug);
      const result = await runBootstrapScenario({
        name: "ambiguous goal is the user's choice",
        description:
          "The user says only 'make this better', which could mean accuracy against the goldens, tone, cost, or speed. That choice picks what 'better' means, so Langy must ask with concrete alternatives and change nothing until the user answers.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(`make "${seeded.experimentSlug}" better`),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: [
          "Langy asks ONE question naming the concrete kinds of better it could pursue (for example accuracy against the expected answers, tone, cost, or speed), as a choices card or a single short question.",
          "Langy changes nothing on the workbench before the user answers: no duplicate, no prompt edit, no evaluator, no run.",
          ...LANGY_CORE_RULE_CRITERIA,
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2: no write landed, so the version counter never moved.
      const after = await getWorkbenchState(seeded.experimentSlug);
      expect(after.version).toBe(before.version);
    });
  });
});
