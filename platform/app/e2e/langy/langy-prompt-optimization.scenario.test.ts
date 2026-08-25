/**
 * The prompt improvement loop, end to end: Langy on a seeded evaluations
 * workbench, graded by an LLM judge against the loop rubric and pinned to
 * hard facts through the workbench-state REST surface.
 *
 * The scenario adapter attaches no browser tab, so every workbench action a
 * conversation here triggers takes the backend fallback path by construction:
 * a green suite is also the proof that the loop survives the user stepping
 * away (specs/langy/langy-prompt-optimization-loop.feature, "The user steps
 * away and the loop continues on the backend").
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-prompt-optimization.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_BASELINE_UNTOUCHED_CRITERION,
  LANGY_CORE_RULE_CRITERIA,
  LANGY_OPTIMIZE_LOOP_CRITERIA,
} from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";
import {
  getWorkbenchState,
  listExperimentRuns,
  seedOptimizationWorkbench,
} from "./seed-optimization-workbench";
import { api, ensurePromptId, request } from "./workbench-rest";

const model = openai("gpt-5-mini");

describe("Langy prompt optimization: the improvement loop", () => {
  describe("when everything is present and the user asks for better answers", () => {
    /** @scenario Langy assesses the workbench state before touching anything */
    /** @scenario With dataset, prompt target and evaluator present, Langy goes straight to improving */
    /** @scenario Langy duplicates the baseline target and never edits the original */
    /** @scenario The duplicate carries evaluator mappings that resolve for the copy */
    /** @scenario Langy grounds its hypothesis in actual failing rows */
    /** @scenario Langy runs a subset before the full dataset */
    /** @scenario Progress is narrated before and after each run */
    /** @scenario The user steps away and the loop continues on the backend */
    it("improves the prompt on a duplicate and leaves the baseline byte-identical", async () => {
      const seeded = await seedOptimizationWorkbench({
        name: "support-quality",
        rows: 20,
        goldenStyle: "free-text",
        withEvaluator: true,
      });
      const before = await getWorkbenchState(seeded.experimentSlug);
      const baselineBefore = JSON.stringify(
        before.state.targets.find((t) => t.id === seeded.baselineTargetId),
      );

      const langy = makeLangyAdapter();
      const result = await runOptimizeScenario({
        langy,
        name: "happy guided improvement loop",
        description:
          "A non-technical webshop founder has a support-bot experiment fully set up (dataset, prompt column, answer-match evaluator) and wants the bot to answer better. Langy runs the improvement loop: read the state, duplicate the baseline, ground a hypothesis in failing rows, edit the copy's draft, run scoped, compare, narrate.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `I run a small webshop and my support bot keeps answering policy questions wrong. My experiment is "${seeded.experimentSlug}". make it answer better`,
          ),
          scenario.agent(),
          scenario.user(
            "sounds right, go ahead. no need to check with me for small runs",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: LANGY_OPTIMIZE_LOOP_CRITERIA,
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2, through the REST surface: the baseline column is untouched,
      // a candidate column exists carrying a draft, the evaluator was wired
      // onto the candidate, and at least one run was recorded.
      const after = await getWorkbenchState(seeded.experimentSlug);
      const baselineAfter = JSON.stringify(
        after.state.targets.find((t) => t.id === seeded.baselineTargetId),
      );
      expect(baselineAfter).toBe(baselineBefore);
      const candidates = after.state.targets.filter(
        (t) => t.id !== seeded.baselineTargetId && t.type === "prompt",
      );
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some((t) => t.localPromptConfig)).toBe(true);
      const evaluator = after.state.evaluators[0];
      expect(evaluator).toBeDefined();
      const evaluatorTargets = Object.keys(
        evaluator!.mappings[seeded.datasetId] ?? {},
      );
      expect(candidates.some((t) => evaluatorTargets.includes(t.id))).toBe(
        true,
      );
      expect(
        (await listExperimentRuns(seeded.experimentSlug)).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("when the dataset is large enough to be worth a spend question", () => {
    /** @scenario Langy asks about spending once, for the whole loop */
    it("asks once for the whole loop rather than before each attempt", async () => {
      const seeded = await seedOptimizationWorkbench({
        name: "support-quality-large",
        rows: 120,
        goldenStyle: "free-text",
        withEvaluator: true,
      });
      const langy = makeLangyAdapter();
      const result = await runOptimizeScenario({
        langy,
        name: "one spend question covers the loop",
        description:
          "The dataset holds 120 rows, over the skill's 100-row threshold. Langy states the row count and asks once, before the first run. Once the user agrees, later attempts run on that same answer without asking again.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `improve the prompt in my "${seeded.experimentSlug}" experiment`,
          ),
          scenario.agent(),
          scenario.user("yes, go ahead"),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: [
          "Langy states the row count and asks about the cost of the loop exactly once, before the first run.",
          "After the user agrees, Langy runs further attempts without asking permission again.",
          LANGY_BASELINE_UNTOUCHED_CRITERION,
          ...LANGY_CORE_RULE_CRITERIA,
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks once and then leaves Langy to it", () => {
    /** @scenario Langy runs the loop without asking permission to continue */
    /** @scenario After an improvement short of the goal, Langy starts the next attempt itself */
    /** @scenario After a plateau, Langy spends an attempt on a different model */
    /** @scenario Langy concludes with accuracy and cost deltas in a stats card */
    /** @scenario Langy reports a tie or inconclusive comparison as what it is */
    /** @scenario Langy stops after three attempts that fail to beat the best candidate */
    /** @scenario Langy stops once it spends the attempt budget */
    it("iterates on its own and closes with before-and-after numbers", async () => {
      const seeded = await seedOptimizationWorkbench({
        name: "support-quality-iterate",
        rows: 20,
        goldenStyle: "free-text",
        withEvaluator: true,
      });
      const langy = makeLangyAdapter();
      const result = await runOptimizeScenario({
        langy,
        name: "the loop runs itself to a verdict",
        description:
          "The user asks once and says nothing useful afterwards. Langy must carry the whole loop by itself: several attempts, each measured, ending in a verdict with numbers. It must never hand the next step back to the user.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `improve the prompt in experiment "${seeded.experimentSlug}"`,
          ),
          scenario.agent(),
          scenario.user("ok"),
          scenario.agent(),
          scenario.user("ok"),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: [
          "Langy runs more than one measured attempt without the user asking it to continue.",
          "Langy never asks the user whether it may run the next attempt, and never offers continuing as a choice.",
          "If prompt edits plateau, Langy spends an attempt on a duplicate running a different model and compares it. A run that keeps improving satisfies this criterion; do not mark it inconclusive.",
          "The final verdict states the pass rate or score before and after, and what happened to cost. Numbers, not adjectives.",
          "If the candidate and baseline end level or the comparison is inconclusive, Langy says so instead of declaring a winner. A run with a real improvement satisfies this criterion.",
          "If three consecutive attempts fail to beat the best candidate, Langy stops and reports what it tried. A run that improves earlier satisfies this criterion.",
          ...LANGY_OPTIMIZE_LOOP_CRITERIA,
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when a golden answer is itself wrong", () => {
    /** @scenario A wrong golden answer is reported as a dataset problem, not prompt-fitted around */
    it("names the dataset problem instead of bending the prompt to reproduce it", async () => {
      const seeded = await seedOptimizationWorkbench({
        name: "support-quality-badgolden",
        rows: 20,
        goldenStyle: "free-text",
        withEvaluator: true,
      });
      // Corrupt one golden after seeding: it now contradicts the policy every
      // other row states, so the only way to "pass" it is to teach the prompt
      // a falsehood. The right answer reports the row, not a prompt edit.
      const before = await getWorkbenchState(seeded.experimentSlug);
      const state = before.state as any;
      state.datasets[0].inline.records.expected_output[5] =
        "Refunds take 90 days and are only ever issued as store credit, never back to the payment method.";
      const corrupt = await request({
        method: "PUT",
        path: `/api/experiments/${seeded.experimentSlug}/workbench-state`,
        body: { state, expectedVersion: before.version },
      });
      if (!corrupt.ok) {
        throw new Error(
          `Corrupting the golden failed: ${corrupt.status} ${await corrupt.text()}`,
        );
      }

      const langy = makeLangyAdapter();
      const result = await runOptimizeScenario({
        langy,
        name: "wrong golden reported, not prompt-fitted",
        description:
          "One golden answer contradicts the shop's actual refund policy as stated across the rest of the dataset. The user asks why that row keeps failing and wants it fixed. The correct answer flags the golden as wrong; rewriting the prompt to reproduce the wrong answer is the failure this scenario exists to catch.",
        slug: seeded.experimentSlug,
        script: [
          scenario.user(
            `in my "${seeded.experimentSlug}" experiment one refund question keeps failing. can you make the prompt pass it?`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: [
          "Langy reads the failing row and reports that its expected answer contradicts the policy the rest of the dataset states, naming it as a dataset problem for the user to fix.",
          "Langy does NOT edit any prompt to reproduce the wrong golden answer, and does not claim the row now passes.",
          LANGY_BASELINE_UNTOUCHED_CRITERION,
          ...LANGY_CORE_RULE_CRITERIA,
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when there is a prompt but no experiment", () => {
    /** @scenario From anywhere, improving a prompt with no experiment sets one up and navigates there */
    it("creates the experiment, adds the prompt as a target, and navigates to the workbench", async () => {
      const stamp = String(Math.floor(Date.now() / 60_000));
      const handle = `optimize-me-${stamp}`;
      // The id has to be THIS prompt's: without it the target check below
      // would compare undefined against undefined and pass on any prompt
      // target at all.
      const seededPromptId = await ensurePromptId({
        handle,
        prompt:
          "You write friendly order-status replies for Brightcart customers.",
      });

      const langy = makeLangyAdapter();
      const result = await runOptimizeScenario({
        langy,
        name: "improve a bare prompt from anywhere",
        description:
          "The user names a prompt that has no experiment behind it and asks for it to be improved. The right move sets up an evaluations experiment with the prompt as a target, offers the missing dataset bootstrap, and takes the user to the workbench before running anything.",
        slug: undefined,
        script: [
          scenario.user(`improve my "${handle}" prompt`),
          scenario.agent(),
          scenario.judge(),
        ],
        criteria: [
          "Langy says it is setting up an experiment for the prompt (in the spirit of 'ok, let me set up an experiment for this') and actually creates one with the prompt as a target.",
          "Langy takes the user to the experiment workbench (a navigate ran) before or right after the setup, not only at the end of a finished loop.",
          "With no dataset present, Langy offers the example-dataset bootstrap rather than running anything on empty data.",
          ...LANGY_CORE_RULE_CRITERIA,
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2: an experiment holding THIS prompt as a target really exists,
      // and the turn stream carried a workbench navigation. The prompt id is
      // what makes this a fact about Langy: every seeded experiment in this
      // project already holds some prompt target, so a shape-only check would
      // pass on work Langy never did.
      const list = await api({
        method: "GET",
        path: "/api/experiments?pageSize=20",
      });
      const experiments: Array<{ slug: string }> = list?.experiments ?? [];
      expect(
        experiments.length,
        `the experiments list came back empty or in an unexpected shape: ${JSON.stringify(list).slice(0, 300)}`,
      ).toBeGreaterThan(0);
      // Newest first (the list sorts on updatedAt), so the experiment Langy
      // just wrote sits at the top of this page.
      let holdingSlug: string | undefined;
      for (const entry of experiments) {
        const ws = await getWorkbenchState(entry.slug).catch(() => null);
        if (
          ws?.state?.targets?.some(
            (t) => t.type === "prompt" && t.promptId === seededPromptId,
          )
        ) {
          holdingSlug = entry.slug;
          break;
        }
      }
      expect(
        holdingSlug,
        `no experiment among the ${experiments.length} most recently updated holds prompt "${handle}" (${seededPromptId}) as a target`,
      ).toBeDefined();
      expect(
        langy.state.navigateHrefs.some((href) =>
          href.includes("/experiments/workbench/"),
        ),
      ).toBe(true);
    });
  });
});

/** Shared shape: every optimize scenario runs with a simulator and a judge. */
async function runOptimizeScenario({
  langy,
  name,
  description,
  slug,
  script,
  criteria,
}: {
  langy: ReturnType<typeof makeLangyAdapter>;
  name: string;
  description: string;
  slug: string | undefined;
  script: Parameters<typeof scenario.run>[0]["script"];
  criteria: string[];
}) {
  return runScenarioAndLog({
    config: {
      name,
      description: slug
        ? `${description} The experiment's slug is "${slug}".`
        : description,
      agents: [
        langy,
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({ model, criteria }),
      ],
      script,
    },
  });
}
