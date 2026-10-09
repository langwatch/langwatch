/**
 * The bootstrap branches of the prompt optimization skill: a workbench missing
 * its dataset, a goal that could mean several things, and a user who names
 * nothing at all. The evaluator-choice branches live next door in
 * langy-evaluator-inference.scenario.test.ts.
 *
 * Judge-graded, with what actually landed asserted through the
 * workbench-state REST surface.
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
import {
  runBootstrapScenario,
  seedWithoutEvaluator,
} from "./optimization-bootstrap-harness";
import { runScenarioAndLog } from "./scenario-logger";
import { getWorkbenchState } from "./seed-optimization-workbench";

const model = openai("gpt-5-mini");

describe("Langy prompt optimization: bootstrapping the missing pieces", () => {
  describe("when there is a prompt but no data", () => {
    /** @scenario With a prompt but no dataset, Langy offers to generate an example dataset */
    /** @scenario The generated bootstrap dataset is sized for iteration and matches the bot's real users */
    /** @scenario The evaluator slug comes from evaluator types, never from memory */
    it("offers a generated dataset, previews it, and lands 15 to 25 realistic rows", async () => {
      const seeded = await seedWithoutEvaluator({
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

  describe("when the goal is ambiguous", () => {
    /** @scenario An ambiguous goal is asked as a choices card before anything changes */
    it("asks with a choices card and changes nothing until the answer", async () => {
      const seeded = await seedWithoutEvaluator({
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

  // The customer this skill is for describes a quality problem, not a task:
  // "the answers are bad". They name no experiment, know no vocabulary, and
  // have nothing set up. Langy has to recognise the improvement loop from
  // that sentence and build the missing pieces, rather than reading it as a
  // request to instrument code or tour the product.
  describe("when the user names no experiment and knows no vocabulary", () => {
    /** @scenario A plain-language quality complaint starts the improvement loop */
    /** @scenario With nothing set up, Langy builds the experiment rather than asking the user to */
    it("recognises the loop from plain words and builds what is missing", async () => {
      const result = await runScenarioAndLog({
        config: {
          name: "plain-language complaint with nothing set up",
          description:
            "A shop owner who is not an engineer says the support chatbot answers badly. There is no experiment, no dataset and no evaluator, and the user names none of those words. Langy must recognise this as the prompt improvement loop, create what it needs, and keep the plan in the user's language.",
          agents: [
            makeLangyAdapter(),
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy treats this as improving the prompt's answers: it works toward measuring the current answers and making them better.",
                "Langy creates the experiment and the data it needs itself, rather than telling the user to create one first.",
                "Langy does not send the user away to instrument their code, add tracing, or connect an SDK before it can help.",
                "Langy explains the plan in the user's words and never asks them to choose an evaluator type, a model, or a mapping.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(
              "I run a small online shop and our support chatbot gives bad answers sometimes. I have nothing set up here yet. Can you help me make its answers better? I am not technical.",
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });
});
