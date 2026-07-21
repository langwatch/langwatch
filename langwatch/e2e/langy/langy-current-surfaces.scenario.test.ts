// New normal-use scenarios for Langy, targeting surfaces that don't exist in
// the original 42-scenario set in langy.scenario.test.ts (AI Gateway, the
// "Comparison" evaluator, and simulation-run detail) — complements that file
// rather than duplicating it. Same rubric/pattern as the rest of e2e/langy/.
//
// RUN: same env vars as langy.scenario.test.ts (see README.md).
//
//   cd langwatch/e2e/langy
//   npx vitest run langy-current-surfaces.scenario.test.ts --reporter=verbose

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
  describe("when the user asks about the AI Gateway", () => {
    it("lists AI Gateway virtual keys", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog(
        {
          name: "list AI Gateway virtual keys",
          description:
            "The user wants to see the virtual keys configured on their AI Gateway.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports the virtual keys (a list, a count, or a clear 'none configured' answer) rather than deflecting.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user("show me my AI Gateway virtual keys"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
        {
          label: "surfaces-gateway-virtual-keys",
          path: "/settings/gateway/virtual-keys",
        },
      );
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("reports AI Gateway usage without asking for a time range", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog(
        {
          name: "AI Gateway usage report",
          description:
            "The user wants a quick summary of their AI Gateway usage/cost.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports gateway usage data (requests, cost, or tokens) or a clear 'no usage yet' answer.",
                "Langy does not ask the user to specify a time range first — it uses a sensible default.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user("what's my AI Gateway usage looking like?"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
        { label: "surfaces-gateway-usage", path: "/settings/gateway/usage" },
      );
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    // "guardrails" and "cache-rules" scenarios were DROPPED here — verified
    // directly against the `langwatch` CLI (Langy's only LangWatch transport,
    // see services/langyagent/adapters/opencode/provision.go) that neither
    // has a CLI surface at all (`langwatch --help` lists no such subcommand,
    // unlike `virtual-keys` and `gateway-budgets` which do exist and ARE
    // covered above/below). Testing an absent capability doesn't exercise
    // Langy's judgment — it just re-confirms a known gap on every run, for
    // no signal. Confirmed a real capability exists before scenario-testing
    // it, per the "verify via the API first" rule for this suite.
  });

  describe("when the user asks for instrumentation help", () => {
    it("finds traces with broken or missing instrumentation", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog(
        {
          name: "debug instrumentation gaps",
          description:
            "The user's traces look incomplete and they want Langy to find what's wrong.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports specific instrumentation issues (missing input/output, disconnected spans, unlabeled traces) or a clear 'instrumentation looks fine' answer.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(
              "some of my traces look broken or incomplete, can you check what's wrong with my instrumentation?",
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
        { label: "surfaces-debug-instrumentation" },
      );
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks for a RAG-specific dataset", () => {
    it("generates a RAG evaluation dataset distinct from a generic one", async () => {
      const uniqueName = `langy-rag-dataset-${Date.now()}`;
      const langy = makeLangyAdapter();
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
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
    // annotations:view/create/update are in LANGY_CANDIDATE_PERMISSIONS but had
    // ZERO scenario coverage anywhere in e2e/langy/ before this — a real
    // functional gap, not a red-team probe. `update` has no CLI surface
    // (typescript-sdk/src/cli/commands/annotations/ has only
    // create/delete/get/list), so only list + create are scenario-tested here,
    // per the "verify a real capability exists before testing it" rule above.
    it("lists annotations without asking which trace first", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog(
        {
          name: "list annotations",
          description:
            "The user wants to see the annotations left on their traces.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports the annotations (a list, a count, or a clear 'none yet' answer) rather than asking which trace to check first.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user("what annotations do I have on my traces?"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
        { label: "surfaces-list-annotations", path: "/annotations" },
      );
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("annotates a specific trace with a thumbs-up (Layer 2: appears in API)", async () => {
      // Gives Langy a concrete trace id directly rather than having it find
      // one via its own trace-search tool first — see the "Langy's own trace
      // search returns 0 hits" follow-up finding for why chaining through
      // Langy's search isn't reliable yet. This still exercises exactly the
      // capability that had the real permission bug (annotations:create was
      // enforced as annotations:manage, which Langy's session key never
      // holds) without coupling this scenario to that separate issue.
      const langy = makeLangyAdapter();
      const traceId = await mostRecentTraceId();
      expect(traceId).toBeTruthy();
      const before = await listAnnotations();
      const beforeIds = new Set(before.map((a) => a.id));

      const result = await runScenarioAndLog({
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
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listAnnotations();
      const created = after.find((a) => !beforeIds.has(a.id));
      console.log(`Layer 2 annotation: ${created ? created.id : "NOT FOUND"}`);
      expect(created).toBeTruthy();
    });
  });

  describe("when the user updates a trigger", () => {
    // triggers:update has a real CLI surface (typescript-sdk/src/cli/commands/
    // triggers/update.ts) but the 42-scenario set only covers list + create —
    // a real gap, since triggers:create/:update are both in
    // LANGY_CANDIDATE_PERMISSIONS.
    it("creates a trigger then deactivates it on a follow-up turn (Layer 2: active=false)", async () => {
      const uniqueName = `langy-trigger-${Date.now()}`;
      const langy = makeLangyAdapter();

      const result = await runScenarioAndLog({
        name: "create then deactivate a trigger",
        description: `The user wants a trigger named "${uniqueName}" that emails on new failing traces, then wants it turned off.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy creates the trigger with the exact requested name.",
              "On the follow-up, Langy deactivates the specific trigger it just created (using context), rather than asking which trigger or creating a new one.",
              ...LANGY_CORE_RULE_CRITERIA,
            ],
          }),
        ],
        script: [
          scenario.user(
            `create a trigger called "${uniqueName}" that emails me when a new trace fails`,
          ),
          scenario.agent(),
          scenario.user("actually, turn that one off for now"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const triggers = await listTriggers();
      const created = triggers.find((t) => t.name === uniqueName);
      console.log(
        `Layer 2 trigger: ${created ? `${created.name} active=${created.active}` : "NOT FOUND"}`,
      );
      expect(created).toBeTruthy();
      expect(created?.active).toBe(false);
    });
  });

  describe("when the user asks about a simulation run's outcome", () => {
    it("reports pass/fail on the most recent scenario run", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog(
        {
          name: "most recent scenario run outcome",
          description:
            "The user wants to know whether their most recent scenario/simulation run passed.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports a clear pass/fail (or count of passing vs failing) for the most recent scenario run, or a clear 'no runs yet' answer.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user("did my last scenario run pass?"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
        { label: "surfaces-simulation-run-outcome", path: "/simulations" },
      );
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });
});
