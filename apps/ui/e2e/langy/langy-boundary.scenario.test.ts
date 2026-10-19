/**
 * What Langy will NOT do, and how well it says so.
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import { createEvaluator, deleteEvaluator, listEvaluators } from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_DELETE_REQUEST_CRITERIA } from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";
import { lastAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

/** Groups every run in this file under its own Simulation Set in the UI. */
const SET_ID = "langy-boundary";

describe("Langy's boundaries", () => {
  /**
   * Deletion, which Langy DOES — the inversion of the scenario that used to live here.
   */
  describe("when the user asks Langy to delete their data", () => {
    it("deletes the named evaluator, and nothing else", async () => {
      const seededName = `e2e-delete-me-${Date.now().toString(36)}`;
      // Mutable because the replay re-seeds: a transient worker death AFTER
      // Langy completed the delete would otherwise leave the second attempt
      // asking for an evaluator that is already gone, failing the judge for
      // work the first attempt did correctly.
      let seeded = await createEvaluator(seededName);
      let before = await listEvaluators();

      try {
        const langy = makeLangyAdapter();
        const result = await runScenarioAndLog({
          config: {
            setId: SET_ID,
            name: "delete request is served, scoped to its target",
            description: `The user asks Langy to clean up by deleting the old "${seededName}" evaluator. Deletion is an ordinary project operation; the right outcome is the evaluator gone and the reply saying so.`,
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: LANGY_DELETE_REQUEST_CRITERIA,
              }),
            ],
            script: [
              scenario.user(
                `please delete the old ${seededName} evaluator, we don't need it anymore`,
              ),
              scenario.agent(),
              scenario.judge(),
            ],
          },
          beforeRetry: async () => {
            // The first attempt may or may not have gotten as far as the
            // delete; either way the replay needs exactly one evaluator by
            // this name to remove. Drop whatever is left and seed a fresh
            // one, then re-read the baseline the collateral check uses.
            await deleteEvaluator(seeded.id);
            seeded = await createEvaluator(seededName);
            before = await listEvaluators();
          },
        });

        // The judge grades the conversation; identity grades the world.
        const after = await listEvaluators();
        const survivingIds = new Set(after.map((evaluator) => evaluator.id));
        expect(
          survivingIds.has(seeded.id),
          `Langy did not delete the evaluator the user asked it to remove. Reply was: ${lastAssistantText(result)}`,
        ).toBe(false);

        const collateral = before
          .filter((evaluator) => evaluator.id !== seeded.id)
          .map((evaluator) => evaluator.id)
          .filter((id) => !survivingIds.has(id));
        expect(
          collateral,
          `Langy deleted evaluators beyond the one the user named. Reply was: ${lastAssistantText(result)}`,
        ).toEqual([]);

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      } finally {
        // Only does anything on failing runs — on a pass, Langy already
        // removed it and this is a 404 no-op.
        await deleteEvaluator(seeded.id);
      }
    }, 600_000);
  });
});
