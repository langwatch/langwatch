// New normal-use scenarios for Langy, targeting surfaces that don't exist in
// the original 42-scenario set in langy.scenario.test.ts (AI Gateway, the
// "Comparison" evaluator, and simulation-run detail) — complements that file
// rather than duplicating it.

import { setupScenarioTracing } from "@langwatch/scenario";

setupScenarioTracing();

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import {
  listAnnotations,
  listDatasets,
  listEvaluators,
  listTriggers,
  mostRecentTraceId,
} from "./langwatch-api";
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

  describe("when the user requests the Comparison evaluator", () => {
    it("creates a Comparison evaluator for two candidates (Layer 2: appears in API)", async () => {
      const uniqueName = `langy-comparison-eval-${Date.now()}`;
      const langy = makeLangyAdapter();

      const result = await runScenarioAndLog({
        config: {
          name: "create a comparison evaluator",
          description:
            "The user wants an evaluator that judges which of two candidate LLM outputs is better, and wants it named " +
            uniqueName +
            ".",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy creates (or reports creating) a comparison-style evaluator that judges between two or more candidate outputs.",
                "Langy uses the exact requested name for the evaluator.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(
              `set up an evaluator called "${uniqueName}" that compares two candidate responses and picks the better one`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const evaluators = await listEvaluators();
      const created = evaluators.find((e) => e.name === uniqueName);
      console.log(`Layer 2 evaluator: ${created ? created.name : "NOT FOUND"}`);
      expect(created).toBeTruthy();
    });
  });

  describe("when the user works with annotations", () => {
    it("annotates a specific trace with a thumbs-up (Layer 2: appears in API)", async () => {
      // Gives Langy a concrete trace id directly rather than having it find one via its
      // own trace-search tool first — see the "Langy's own trace search returns 0 hits"
      // follow-up finding for why chaining through Langy's search isn't reliable yet.
      const langy = makeLangyAdapter();
      const traceId = await mostRecentTraceId();
      expect(traceId).toBeTruthy();
      const before = await listAnnotations();
      const beforeIds = new Set(before.map((a) => a.id));

      const result = await runScenarioAndLog({
        config: {
          name: "annotate a specific trace",
          description: `The user wants to leave a thumbs-up annotation on trace "${traceId}".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy actually creates the annotation (reports success / an id) rather than only describing what an annotation is.",
                "Langy uses the exact trace id the user gave it.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(
              `leave a thumbs-up annotation on trace "${traceId}" with the comment "looks correct"`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listAnnotations();
      const created = after.find((a) => !beforeIds.has(a.id));
      console.log(`Layer 2 annotation: ${created ? created.id : "NOT FOUND"}`);
      expect(created).toBeTruthy();
    });
  });

  describe("when the user asks for a trigger", () => {
    // Langy holds full CRUD on `triggers` (owner decision, 2026-08-21) — this used to
    // be the permission-boundary scenario, back when the policy withheld the write from
    // every session key.
    it("creates the trigger (Layer 2: trigger exists)", async () => {
      const uniqueName = `langy-trigger-${Date.now()}`;
      const langy = makeLangyAdapter();

      const result = await runScenarioAndLog({
        config: {
          name: "trigger creation capability",
          description: `The user wants a trigger named "${uniqueName}" that emails on new failing traces — a write Langy's credentials now carry.`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy creates the trigger named "${uniqueName}" (or clearly reports the concrete result of attempting it), rather than refusing on permission grounds or handing the user a CLI command to run themselves.`,
                "Langy does not fake the trigger through some other write (no workflow, monitor, or other resource stood up as a substitute the user did not ask for).",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(
              `create a trigger called "${uniqueName}" that emails me when a new trace fails`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const triggers = await listTriggers();
      const created = triggers.find((t) => t.name === uniqueName);
      console.log(
        `Layer 2 trigger capability: ${created ? `created ${created.name}` : "NOT created"}`,
      );
      expect(created).toBeTruthy();
    });
  });
});
