// Scenario tests for Langy, driven through the real product surface (see
// langy-agent.ts). All LANGY_*/LW_BASE_URL/LANGWATCH_API_KEY env vars default to this
// repo's local haven seed identity (see config.ts) — a bare

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";

import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";
import { listDatasets, resetEvaluationResources } from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";

const LW_BASE = LW_BASE_URL;
const LW_KEY = LANGWATCH_API_KEY;

async function deleteAllTestDatasets() {
  const datasets = await listDatasets();
  const test = datasets.filter(
    (d) =>
      d.name?.includes("langy-") ||
      d.name?.includes("failures-") ||
      d.name?.includes("langy-scenario"),
  );
  await Promise.all(
    test.map(async (d) => {
      const res = await fetch(`${LW_BASE}/api/dataset/${d.id}`, {
        method: "DELETE",
        headers: { "X-Auth-Token": LW_KEY },
      });
      if (!res.ok) {
        throw new Error(`Failed deleting dataset ${d.id}: ${res.status} ${await res.text()}`);
      }
    }),
  );
  if (test.length) console.log(`[setup] Deleted ${test.length} stale test datasets`);
}

const model = openai("gpt-5-mini");

describe("Langy via HTTP wrapper", () => {
  beforeAll(async () => {
    await deleteAllTestDatasets();
  });

  describeOutOfScopeRequests();
  describeGithubPrConnect();
});

function describeOutOfScopeRequests(): void {
  describe("when the request is out of scope or unanswerable", () => {
    it("does not ask clarifying questions for an ambiguous but actionable request", async () => {
      // Pre-existing monitors turn the designed batch-versus-live question
      // into a reuse-versus-create one, which the criteria do not describe;
      // restore the designed empty state on both edges (the after unleaks
      // whatever a sensible-default setup created).
      await resetEvaluationResources();
      try {
        const langy = makeLangyAdapter();
        const result = await runScenarioAndLog({
          config: {
            name: "no clarifying questions",
            description:
              "The user says 'set up evaluations' — vague, but Langy should pick a sensible default and do it, not ask 10 questions.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  // The batch-versus-live choice is the ONE decision the design
                  // leaves with the user (it picks what gets tested and spends
                  // their money); everything else Langy decides itself.
                  "Langy moved the request forward with real work: it surveyed what exists (evaluators, agents, or evaluator types) and then either set up a sensible default or asked ONE question, a choices card whose subject is the batch-experiment-versus-live-monitor decision (additional options on that single card are acceptable).",
                  "Langy did NOT interrogate the user: no chain of setup questions, no 'what kind of evaluations?', no asking the user to restate the goal.",
                ],
              }),
            ],
            script: [
              scenario.user("set up evaluations for me"),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });
        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      } finally {
        await resetEvaluationResources();
      }
    });
  });
}

function describeGithubPrConnect(): void {
  describe("when user asks to open a GitHub PR", () => {
    // Unconnected: the worker's github.md skill instructs Langy to emit the
    // `[langy:connect-github]` sentinel so the sidebar can render the in-chat Connect
    // card.

    it("renders the connect card for an unconnected user instead of erroring", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "github unconnected → connect card",
        description:
          "The user wants to open a PR on a repo but hasn't connected GitHub yet. Langy should surface the connect affordance, not error out or ask for a personal access token.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy surfaces the in-chat Connect GitHub card or otherwise prompts the user to connect — it does NOT just say 'I can't do that'.",
              "Langy does NOT ask the user to paste a personal access token.",
              "Langy does NOT run `gh auth login` or otherwise try to authenticate inline.",
              // Scoped to the reply on purpose: tool-result messages are the
              // product's command cards, and a failed clone's stderr on a card
              // is expected surface, not Langy relaying an error.
              "Langy's own reply text does NOT relay raw error output or a stack trace (error text inside tool-result messages does not count).",
            ],
          }),
        ],
        script: [
          scenario.user("fix the prompt drift in acme/service-x and open a PR for it"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });
}
