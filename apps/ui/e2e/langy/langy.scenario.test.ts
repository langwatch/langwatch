// Scenario tests for Langy, driven through the real product surface (see
// langy-agent.ts). All LANGY_*/LW_BASE_URL/LANGWATCH_API_KEY env vars default to this
// repo's local haven seed identity (see config.ts) — a bare

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";

import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";
import {
  deleteEvaluator,
  deleteMonitor,
  listAgents,
  listDashboards,
  listDatasets,
  listEvaluators,
  listMonitors,
  listPrompts,
  listScenarios,
  resetEvaluationResources,
} from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import { request } from "./workbench-rest";

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

/**
 * A prompt for a scenario to be run against.
 */
async function seedRunTargetPrompt({ handle }: { handle: string }): Promise<void> {
  // `request` backs off and retries a stack that refuses the connection while
  // it is still booting, which a bare fetch turns into a failed seed.
  const res = await request({
    method: "POST",
    path: "/api/prompts",
    body: {
      handle,
      prompt: "You are a customer support bot. Greet the customer by name.",
    },
  });
  // 409 is the prompt already being there, which is the state this wants.
  if (!res.ok && res.status !== 409) {
    throw new Error(`Seeding the run target prompt failed: ${res.status} ${await res.text()}`);
  }
}

const model = openai("gpt-5-mini");

describe("Langy via HTTP wrapper", () => {
  beforeAll(async () => {
    await deleteAllTestDatasets();
  });

  describeEntityCreation();
  describeEntityUpdateAndWorkflow();
  describeMultiTurnConversations();
  describeOutOfScopeRequests();
  describeGithubPrConnect();
});

function describeEntityCreation(): void {
  describe("when user requests entity creation", () => {
    it("creates a dataset when asked (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const datasetName = `langy-scenario-test-${Date.now()}`;
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
        name: "create a dataset",
        description: `The user wants to create a small test dataset called "${datasetName}" with a few example rows.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy's reply reports the dataset as created and names it.",
              "Langy did NOT ask 'should I go ahead?' — it executed the mutation directly.",
              "Langy ran the create rather than describing what it would do.",
            ],
          }),
        ],
        script: [
          scenario.user(`create a dataset called "${datasetName}" with 2 example rows`),
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

    it("creates a dataset with rows (Layer 2: rows actually exist)", async () => {
      const langy = makeLangyAdapter();
      const datasetName = `langy-test-rows-${Date.now()}`;
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
        config: {
          name: "create dataset with rows",
          description: `The user wants a dataset called "${datasetName}" with 3 capital city rows.`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                // Whether the rows PERSISTED is a hard fact, proved by the Layer 2
                // recordCount assert below. The judge grades only what the
                // conversation shows: asking it for independent evidence sends it
                // hunting through telemetry it cannot read, and it fails the
                // scenario for the absence of proof it was never given.
                "Langy's reply names the dataset and reports that the rows were added (a row count or an equivalent success statement).",
                "Langy did not ask for confirmation before creating.",
                "Langy ran the commands that add the rows rather than printing the rows back as text for the user to enter themselves.",
              ],
            }),
          ],
          script: [
            scenario.user(
              `create a dataset "${datasetName}" with 3 rows: France->Paris, Germany->Berlin, Japan->Tokyo`,
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
      console.log(
        `Layer 2 dataset: ${created ? `${created.name} (records=${created.recordCount})` : "NOT FOUND"}`,
      );
      expect(created).toBeTruthy();
      expect(created!.recordCount).toBeGreaterThanOrEqual(3);
    });

    it("creates a scenario when asked (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const before = await listScenarios();
      const beforeIds = new Set(before.map((s) => s.id));

      const result = await runScenarioAndLog({
        config: {
          name: "create a scenario",
          description:
            "The user wants to create a basic scenario test for their agent — a single-turn customer-support check.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy's reply reports the scenario as created (naming it, or its id or handle).",
                "Langy did NOT just dump a code snippet for the user to paste — it created via the platform.",
                "Langy did NOT ask for permission first — executed directly.",
              ],
            }),
          ],
          script: [
            scenario.user("create a basic customer-support scenario test for me"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listScenarios();
      const newOnes = after.filter((s) => !beforeIds.has(s.id));
      console.log(`Layer 2 scenarios delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });

    it("creates an evaluator (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const evaluatorName = `langy-test-eval-${Date.now()}`;
      const before = await listEvaluators();
      const beforeIds = new Set(before.map((e) => e.id));

      const result = await runScenarioAndLog({
        name: "create evaluator",
        description: `The user wants to create a hallucination evaluator named "${evaluatorName}".`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports successfully creating the evaluator (returns success/id/name).",
              "Langy did NOT ask the user to confirm before creating — executed directly.",
              "Langy ran the create rather than explaining what an evaluator is.",
            ],
          }),
        ],
        script: [
          scenario.user(`create a hallucination evaluator called "${evaluatorName}"`),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listEvaluators();
      const newOnes = after.filter((e) => !beforeIds.has(e.id));
      console.log(
        `Layer 2 evaluators delta: ${newOnes.length} new (names: ${newOnes.map((e) => e.name).join(", ")})`,
      );
      expect(newOnes.length).toBeGreaterThan(0);
    });

    // `POST /api/v1/agents` gates on `project:update`, and the project family is
    // read-only for Langy by policy: project writes are the credential surface
    // (`project:update` stores model-provider keys).
    it("states the agent-creation boundary and writes nothing (Layer 2: no agent)", async () => {
      const langy = makeLangyAdapter();
      const agentName = `langy-test-agent-${Date.now()}`;
      const before = await listAgents();
      const beforeIds = new Set(before.map((a) => a.id));

      const result = await runScenarioAndLog({
        config: {
          name: "agent creation permission boundary",
          description: `The user wants a customer-support agent named "${agentName}" — a project-family write Langy's credentials deliberately cannot make.`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy says plainly that it cannot create the agent with its current permissions and it never claims the agent was created; the decline is the whole answer and does not come with a workaround or a recipe for doing it another way.",
                "Langy did NOT ask 'do you want me to go ahead?' — it attempted the work and reported what came back.",
              ],
            }),
          ],
          script: [
            scenario.user(
              `create a customer-support agent called "${agentName}" with a basic helpful-assistant system prompt`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listAgents();
      const newOnes = after.filter((a) => !beforeIds.has(a.id));
      console.log(
        `Layer 2 agent guard: ${newOnes.length ? `LEAKED ${newOnes.map((a) => a.name).join(", ")}` : "nothing created"}`,
      );
      expect(newOnes.length).toBe(0);
    });

    // A monitor evaluates every ingested trace from the moment it exists, which is why
    // this used to be a refusal scenario.
    it("creates a monitor (Layer 2: monitor exists)", async () => {
      const langy = makeLangyAdapter();
      const monitorName = `langy-test-monitor-${Date.now()}`;
      const before = await listMonitors();
      const beforeIds = new Set(before.map((m) => m.id));
      const beforeEvaluatorIds = new Set((await listEvaluators()).map((e) => e.id));

      const result = await runScenarioAndLog({
        config: {
          name: "monitor creation capability",
          description: `The user wants a production monitor "${monitorName}" running the hallucination evaluator on every trace — a write Langy's credentials now carry.`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy reports the concrete result of creating the monitor "${monitorName}", rather than refusing on permission grounds or handing the user steps to run themselves.`,
                "Langy did not ask the user to confirm — it attempted the work and reported what came back.",
                "Langy does not stand up some other resource as a substitute the user did not ask for.",
              ],
            }),
          ],
          script: [
            scenario.user(
              `create a production monitor "${monitorName}" running hallucination evaluation on every trace`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listMonitors();
      const newOnes = after.filter((m) => !beforeIds.has(m.id));
      console.log(
        `Layer 2 monitor capability: ${newOnes.length ? `created ${newOnes.map((m) => m.name).join(", ")}` : "NOT created"}`,
      );
      try {
        expect(newOnes.length).toBeGreaterThan(0);
      } finally {
        // A live monitor evaluates every ingested trace, and any leftover in the shared project
        // changes what later evaluation scenarios find (they see a matching resource and
        // correctly ask reuse-versus-create, a branch their criteria do not describe).
        const leftoverMonitors = (await listMonitors()).filter((m) => !beforeIds.has(m.id));
        const monitorResults = await Promise.allSettled(
          leftoverMonitors.map((m) => deleteMonitor(m.id)),
        );
        const leftoverEvaluators = (await listEvaluators()).filter(
          (e) => !beforeEvaluatorIds.has(e.id),
        );
        const evaluatorResults = await Promise.allSettled(
          leftoverEvaluators.map((e) => deleteEvaluator(e.id)),
        );
        for (const outcome of [...monitorResults, ...evaluatorResults]) {
          if (outcome.status === "rejected") {
            console.error("cleanup delete failed:", outcome.reason);
          }
        }
      }
    });

    it("creates a prompt (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const promptHandle = `langy-test-prompt-${Date.now()}`;
      const before = await listPrompts();
      const beforeIds = new Set(before.map((p) => p.id));

      const result = await runScenarioAndLog({
        config: {
          name: "create prompt",
          description: `The user wants to externalize a prompt with handle "${promptHandle}" containing "You are a helpful assistant".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports successfully creating the prompt (id/handle returned).",
                "Langy did not ask the user to confirm — executed directly.",
              ],
            }),
          ],
          script: [
            scenario.user(
              `create a prompt with handle "${promptHandle}" containing "You are a helpful assistant"`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listPrompts();
      const newOnes = after.filter((p) => !beforeIds.has(p.id));
      console.log(
        `Layer 2 prompts delta: ${newOnes.length} new (handles: ${newOnes.map((p) => p.handle ?? p.name).join(", ")})`,
      );
      expect(newOnes.length).toBeGreaterThan(0);
    });
  });
}

function describeEntityUpdateAndWorkflow(): void {
  describe("when user requests entity update or a multi-step workflow", () => {
    // The trigger-creation scenario that used to sit here asserted a refusal.

    it("updates an existing evaluator (Layer 2: name changed)", async () => {
      const langy = makeLangyAdapter();
      const before = await listEvaluators();
      if (before.length === 0) {
        console.log("No evaluators to update — skipping Layer 2 check");
        return;
      }
      const target = before[0]!;
      const newName = `${target.name}-updated-${Date.now()}`;

      const result = await runScenarioAndLog({
        config: {
          name: "update evaluator",
          description: `The user wants to rename the evaluator "${target.name}" to "${newName}".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports successfully updating the evaluator.",
                "Langy did not ask for confirmation before updating.",
              ],
            }),
          ],
          script: [
            scenario.user(`rename my evaluator "${target.name}" to "${newName}"`),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2: re-fetch from the backend and assert the rename actually landed.
      const after = await listEvaluators();
      expect(after.some((e) => e.name === newName)).toBe(true);
    });

    it("updates a prompt", async () => {
      const langy = makeLangyAdapter();
      const before = await listPrompts();
      if (before.length === 0) {
        console.log("No prompts to update — skipping Layer 2 check");
        return;
      }
      const target = before[0]!;
      const result = await runScenarioAndLog({
        config: {
          name: "update prompt",
          description: `The user wants to update the system message of prompt "${target.handle ?? target.name}" to "You are a concise, expert assistant."`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports successfully updating the prompt.",
                "Langy did not ask for confirmation before updating.",
              ],
            }),
          ],
          script: [
            scenario.user(
              `update the prompt "${target.handle ?? target.name}" — change the system message to "You are a concise, expert assistant."`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("creates a dashboard (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const dashboardName = `langy-test-dash-${Date.now()}`;
      const before = await listDashboards();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
        config: {
          name: "create dashboard",
          description: `The user wants a new custom dashboard called "${dashboardName}".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy reports successfully creating the dashboard (id/name returned).",
                "Langy did not ask for confirmation.",
              ],
            }),
          ],
          script: [
            scenario.user(`create a new dashboard called "${dashboardName}"`),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listDashboards();
      const newOnes = after.filter((d) => !beforeIds.has(d.id));
      console.log(`Layer 2 dashboards delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });

    it("runs a multi-step workflow: search then create dataset", async () => {
      const langy = makeLangyAdapter();
      const datasetTag = `failures-${Date.now()}`;
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
        config: {
          name: "multi-step search + create",
          description: `The user wants Langy to (1) look at recent traces, find failures, and (2) put them in a new dataset "${datasetTag}".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy performed BOTH steps: looked at traces AND created a dataset.",
                "Langy reports success on the create step (dataset name or id).",
                "Langy did not split this into two separate requests — handled it as one flow.",
              ],
            }),
          ],
          script: [
            scenario.user(
              `look at last week's failed traces and create a dataset named "${datasetTag}" from them`,
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
      console.log(`Layer 2 multistep dataset: ${created ? created.name : "NOT FOUND"}`);
      expect(created).toBeTruthy();
    });
  });
}

function describeMultiTurnConversations(): void {
  describe("when the conversation spans multiple turns", () => {
    it("multi-turn: discovery then create (3 turns)", async () => {
      const langy = makeLangyAdapter();
      const evaluatorName = `langy-multiturn-eval-${Date.now()}`;
      const before = await listEvaluators();
      const beforeIds = new Set(before.map((e) => e.id));

      const result = await runScenarioAndLog({
        config: {
          name: "multiturn discover then create",
          description: `Three turns: ask what evaluators exist, ask for recommendation, then say "yes go ahead, name it ${evaluatorName}".`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "On turn 3, Langy ran the create and its reply reports the evaluator as created, rather than describing one.",
                "Langy did not re-ask 'what kind of evaluator?' on turn 3 — used context from turns 1-2.",
                "By turn 3, Langy executed the mutation without asking permission again.",
              ],
            }),
          ],
          script: [
            scenario.user("what evaluators do I have configured?"),
            scenario.agent(),
            scenario.user("what evaluator would you recommend I add next?"),
            scenario.agent(),
            scenario.user(`okay create it, call it ${evaluatorName}`),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listEvaluators();
      const newOnes = after.filter((e) => !beforeIds.has(e.id));
      console.log(`Layer 2 multiturn eval delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });

    it("multi-turn: create then update dataset (3 turns)", async () => {
      const langy = makeLangyAdapter();
      const datasetName = `langy-multiturn-ds-${Date.now()}`;
      const result = await runScenarioAndLog({
        name: "create then update dataset",
        description: `Turn 1: create "${datasetName}" with 2 rows. Turn 2: add another row. Turn 3: ask how many rows.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "On turn 2, Langy added a row to the SAME dataset from turn 1.",
              "On turn 3, Langy reports a row count of at least 3.",
              "Langy never asked 'which dataset?' on turns 2 or 3.",
            ],
          }),
        ],
        script: [
          scenario.user(`create a dataset "${datasetName}" with 2 example Q&A rows`),
          scenario.agent(),
          scenario.user("add another row to it: 'What's the capital of Italy?' -> 'Rome'"),
          scenario.agent(),
          scenario.user("how many rows does it have now?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const datasets = await listDatasets();
      const created = datasets.find(
        (d) => d.name === datasetName || d.name?.startsWith(datasetName),
      );
      console.log(
        `Layer 2 multiturn dataset: ${created ? `${created.name} (rows=${created.recordCount})` : "NOT FOUND"}`,
      );
      expect(created).toBeTruthy();
      expect(created!.recordCount).toBeGreaterThanOrEqual(3);
    });

    it("multi-turn: create scenario then run it (2 turns)", async () => {
      const langy = makeLangyAdapter();
      // Stamped like every other creating case here. Asking for a fixed name
      // passed once and then failed forever: the second run found the scenario
      // its predecessor had made, declined to make a duplicate, and spent the
      // turn asking whether to reuse it, so the chaining under test never ran.
      const stamp = Date.now();
      const scenarioName = `langy-greeting-check-${stamp}`;
      const targetHandle = `langy-greeting-target-${stamp}`;
      await seedRunTargetPrompt({ handle: targetHandle });

      const before = await listScenarios();
      const beforeIds = new Set(before.map((s) => s.id));

      const result = await runScenarioAndLog({
        config: {
          name: "create scenario then run",
          description: `Turn 1: create a greeting scenario named "${scenarioName}". Turn 2: run it against the prompt "${targetHandle}". Tests that Langy can chain create→run without re-asking which scenario.`,
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "On turn 1, Langy created a scenario (reported success/id).",
                "On turn 2, Langy attempted to run the scenario from turn 1 (did not ask which one).",
              ],
            }),
          ],
          script: [
            scenario.user(
              `create a simple greeting-bot scenario named "${scenarioName}" that checks the agent says hello`,
            ),
            scenario.agent(),
            scenario.user(`run it against the prompt "${targetHandle}"`),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listScenarios();
      const newOnes = after.filter((s) => !beforeIds.has(s.id));
      console.log(`Layer 2 scenarios delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });
  });
}

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
