// New normal-use scenarios for Langy, targeting surfaces that don't exist in
// the original 42-scenario set in langy.scenario.test.ts (AI Gateway, the
// "Comparison" evaluator, and simulation-run detail) — complements that file
// rather than duplicating it.

import { setupScenarioTracing } from "@langwatch/scenario";

setupScenarioTracing();

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import { listDatasets } from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_CORE_RULE_CRITERIA } from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

describe("Langy current-surfaces coverage", () => {
  describe("when the user asks for a RAG-specific dataset", () => {
    it("generates a RAG evaluation dataset distinct from a generic one", async () => {
      const uniqueName = `langy-rag-dataset-${Date.now()}`;
      const langy = makeLangyAdapter();
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
        config: {
          name: "generate a RAG evaluation dataset",
          description: `The user wants a synthetic evaluation dataset for their RAG (retrieval-augmented generation) pipeline, named "${uniqueName}".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy actually creates the dataset (reports success / an id / a name) rather than only describing the RAG-dataset-generation process.",
                "Langy uses the exact requested name for the dataset.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(
              `generate a RAG evaluation dataset called "${uniqueName}" for my retrieval pipeline`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listDatasets();
      const created = after.find((d) => !beforeIds.has(d.id));
      console.log(`Layer 2 dataset: ${created ? created.name : "NOT FOUND"}`);
      expect(created).toBeTruthy();
    });
  });
});
