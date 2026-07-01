// Scenario tests for Langy. These hit the pod wrapper via HTTP directly,
// without going through the LangWatch Next.js backend. Run with:
//
//   LANGY_AGENT_URL=http://172.22.160.1:8081 \
//   OPENAI_API_KEY=$YOUR_VK \
//   OPENAI_BASE_URL=http://localhost:5563/v1 \
//   LANGWATCH_API_KEY=... \
//   LW_BASE_URL=http://localhost:5560 \
//   npx vitest run langy.scenario.test.ts --reporter=verbose

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
import {
  listAgents,
  listDashboards,
  listDatasets,
  listEvaluators,
  listMonitors,
  listPrompts,
  listScenarios,
  listTriggers,
} from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";

const LW_BASE = process.env.LW_BASE_URL ?? "http://localhost:5560";
const LW_KEY = process.env.LANGWATCH_API_KEY ?? "";

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
        throw new Error(
          `Failed deleting dataset ${d.id}: ${res.status} ${await res.text()}`,
        );
      }
    }),
  );
  if (test.length)
    console.log(`[setup] Deleted ${test.length} stale test datasets`);
}

const model = openai("gpt-5-mini");

describe("Langy via HTTP wrapper", () => {
  beforeAll(async () => {
    await deleteAllTestDatasets();
  });

  describe("when user asks about analytics or traces", () => {
    it("answers a traces request by calling search_traces", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "search recent traces",
        description:
          "The user is using LangWatch and wants to see recent trace activity.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports trace data or a clear empty-result message.",
              "Langy does NOT ask clarifying questions — it just runs the search.",
              "Langy does NOT offer 'next actions' or options.",
            ],
          }),
        ],
        script: [
          scenario.user("show me recent traces"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("answers an analytics request by reporting the metric", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "ask for cost",
        description:
          "The user wants the current cost of their LangWatch usage.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a cost figure or a clear 'no data' answer.",
              "Langy does not pivot to a different topic.",
              "Langy doesn't ask the user to clarify the time range — uses a sensible default.",
            ],
          }),
        ],
        script: [
          scenario.user("what's my cost"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns latency stats without asking for clarification", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "latency query",
        description: "The user wants to know their average LLM latency.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a latency figure (ms or seconds) or 'no data'.",
              "Langy does not ask which metric or which time range.",
              "Langy stays on topic — does not pivot to costs or traces.",
            ],
          }),
        ],
        script: [
          scenario.user("what's my average latency?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns p95 latency", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "p95 latency",
        description: "The user asks for p95 latency specifically.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a p95 latency figure or 'no data'.",
              "Langy does not confuse p95 with average — it specifically addressed p95.",
            ],
          }),
        ],
        script: [
          scenario.user("what is my p95 latency?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns eval pass rate", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "eval pass rate",
        description: "The user wants to know their evaluator pass rate.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns an eval pass rate (% or fraction) or 'no data'.",
              "Langy does not pivot to cost or latency.",
            ],
          }),
        ],
        script: [
          scenario.user("what's my eval pass rate?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns analytics for a user-specified time range", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "analytics with explicit time range",
        description:
          "The user specifies 'last week' — Langy should honor that, not default to 24h.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a cost or trace-count figure.",
              "Langy used 'last week' (or 7 days) as the time range — not 24h.",
            ],
          }),
        ],
        script: [
          scenario.user("how much did I spend last week?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("explains trace failures in plain English", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "trace failure analysis",
        description:
          "The user wants Langy to find recent failed traces and explain what went wrong.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              // Single combined criterion: the verdict hinges on whether Langy
              // gave a coherent answer regardless of whether the project had
              // failures. Previously this was split into three criteria where
              // "explains failure reasons" was always inconclusive on a project
              // with zero failures, and the judge would mark the scenario as
              // overall PASS while leaving that criterion unmet — a textbook
              // pass-by-absence-of-data. Now: if failures exist, Langy must
              // explain them; if they don't, Langy must say so explicitly.
              "Langy gave a useful answer: either explained at least one failure (error type / status code / evaluator name / plain-language reason) when failures existed, OR clearly said no failures were found in the time window. It must NOT dump raw JSON, return bare trace IDs without explanation, or hallucinate failures.",
            ],
          }),
        ],
        script: [
          scenario.user("find traces that failed recently and tell me why"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns an analytics summary with a LangWatch dashboard link", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "analytics with link",
        description:
          "The user wants their trace volume for the past week and a link to see the trend.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a concrete number or summary statistic.",
              "Langy includes a clickable LangWatch URL pointing to analytics/dashboards/messages.",
              "Langy doesn't ask the user to clarify timeframe.",
            ],
          }),
        ],
        script: [
          scenario.user(
            "what's my trace volume this week and where can I see the trend?",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("gets details for a specific trace by drilling in", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "get trace detail",
        description:
          "The user wants to drill into a specific trace to see its inputs, outputs, and span details.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returned details about a specific trace (input, output, latency, or span info).",
              "Langy did NOT just list all traces — it retrieved and displayed details.",
            ],
          }),
        ],
        script: [
          scenario.user("show me recent traces"),
          scenario.agent(),
          scenario.user("get the full details of the most recent one"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when user requests read-only listings", () => {
    it("lists evaluators", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list evaluators",
        description:
          "The user wants to see what evaluators they have configured.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports evaluator count or a clear 'none configured' message.",
              "Langy doesn't pivot to monitors or scenarios.",
            ],
          }),
        ],
        script: [
          scenario.user("what evaluators do I have?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists datasets", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list datasets",
        description: "The user wants to see their existing LangWatch datasets.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports dataset count or a clear empty state.",
              "Langy doesn't pivot to evaluators or traces.",
            ],
          }),
        ],
        script: [
          scenario.user("list my datasets"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists scenarios", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list scenarios",
        description:
          "The user wants to see their existing LangWatch scenario tests.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports scenario count or a clear empty state.",
              "Langy doesn't ask the user to clarify what 'scenarios' means.",
            ],
          }),
        ],
        script: [
          scenario.user("what scenario tests do I have?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists agents", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list agents",
        description:
          "The user wants to see the agents registered in LangWatch.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports agent count or a clear empty state.",
              "Langy doesn't confuse agents with evaluators or scenarios.",
            ],
          }),
        ],
        script: [
          scenario.user("show me my agents"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists prompts", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list prompts",
        description:
          "The user wants to see their versioned prompts in LangWatch.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports prompt count or a clear empty state.",
              "Langy doesn't pivot to datasets or evaluators.",
            ],
          }),
        ],
        script: [
          scenario.user("what prompts do I have?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists monitors", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list monitors",
        description:
          "The user wants to see what online evaluation monitors they have configured.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports monitor count or a clear 'no monitors' message.",
              "Langy doesn't pivot to evaluators or scenarios — it matched 'monitor'.",
              "Langy doesn't ask the user to clarify what they mean by monitor.",
            ],
          }),
        ],
        script: [
          scenario.user("what monitors do I have set up?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists dashboards", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list dashboards",
        description: "The user wants to see their LangWatch custom dashboards.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports dashboard count or a clear empty-state.",
              "Langy doesn't pivot to analytics or monitors.",
            ],
          }),
        ],
        script: [
          scenario.user("show my dashboards"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists workflows", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list workflows",
        description: "The user wants to see their LangWatch workflows.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports workflow count or a clear empty-state.",
              "Langy doesn't ask for clarification.",
            ],
          }),
        ],
        script: [
          scenario.user("what workflows do I have?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("lists triggers", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "list triggers",
        description: "The user wants to see their LangWatch alert triggers.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports trigger count or a clear empty state.",
              "Langy doesn't pivot to monitors or evaluators.",
            ],
          }),
        ],
        script: [
          scenario.user("show me my alert triggers"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("audits the setup and reports the biggest gap", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "audit setup",
        description:
          "The user wants Langy to audit their LangWatch setup and tell them the single biggest gap.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy ran multiple list-* checks (traces, evaluators, scenarios, datasets, prompts) and synthesized a finding.",
              "Langy named ONE biggest gap rather than dumping a checklist.",
              "Langy didn't ask the user what 'audit' means.",
            ],
          }),
        ],
        script: [
          scenario.user("audit my setup, what's the biggest gap?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when user requests entity creation or update", () => {
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
              "Langy actually created the dataset (reports success / an id / a name).",
              "Langy did NOT ask 'should I go ahead?' — it executed the mutation directly.",
              "Langy did NOT just describe what it would do — it actually did it.",
            ],
          }),
        ],
        script: [
          scenario.user(
            `create a dataset called "${datasetName}" with 2 example rows`,
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

    it("creates a dataset with rows (Layer 2: rows actually exist)", async () => {
      const langy = makeLangyAdapter();
      const datasetName = `langy-test-rows-${Date.now()}`;
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));

      const result = await runScenarioAndLog({
        name: "create dataset with rows",
        description: `The user wants a dataset called "${datasetName}" with 3 capital city rows.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy actually created the dataset and populated it with rows (reports row count / success).",
              "Langy did not ask for confirmation before creating.",
              "Langy did not just print the rows back as text — committed them.",
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
        name: "create a scenario",
        description:
          "The user wants to create a basic scenario test for their agent — a single-turn customer-support check.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy actually created a scenario (reports success / id / handle).",
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
              "Langy did NOT just describe what an evaluator is — actually created one.",
            ],
          }),
        ],
        script: [
          scenario.user(
            `create a hallucination evaluator called "${evaluatorName}"`,
          ),
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

    it("creates an agent (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const agentName = `langy-test-agent-${Date.now()}`;
      const before = await listAgents();
      const beforeIds = new Set(before.map((a) => a.id));

      const result = await runScenarioAndLog({
        name: "create agent",
        description: `The user wants to create a customer-support agent named "${agentName}".`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports successfully creating the agent (success/id/name returned).",
              "Langy did NOT ask 'do you want me to go ahead?' — executed directly.",
              "Langy did NOT just write a system prompt for the user — actually created the agent record.",
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
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listAgents();
      const newOnes = after.filter((a) => !beforeIds.has(a.id));
      console.log(
        `Layer 2 agents delta: ${newOnes.length} new (names: ${newOnes.map((a) => a.name).join(", ")})`,
      );
      expect(newOnes.length).toBeGreaterThan(0);
    });

    it("creates a monitor (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const monitorName = `langy-test-monitor-${Date.now()}`;
      const before = await listMonitors();
      const beforeIds = new Set(before.map((m) => m.id));

      const result = await runScenarioAndLog({
        name: "create monitor",
        description: `The user wants a production monitor "${monitorName}" that runs the hallucination evaluator on every trace.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports successfully creating the monitor (id/name returned).",
              "Langy did not ask the user to confirm — executed directly.",
              "Langy did not just describe what a monitor is — actually created one.",
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
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listMonitors();
      const newOnes = after.filter((m) => !beforeIds.has(m.id));
      console.log(
        `Layer 2 monitors delta: ${newOnes.length} new (names: ${newOnes.map((m) => m.name).join(", ")})`,
      );
      expect(newOnes.length).toBeGreaterThan(0);
    });

    it("creates a prompt (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const promptHandle = `langy-test-prompt-${Date.now()}`;
      const before = await listPrompts();
      const beforeIds = new Set(before.map((p) => p.id));

      const result = await runScenarioAndLog({
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

    it("creates a trigger (Layer 2: appears in API)", async () => {
      const langy = makeLangyAdapter();
      const triggerName = `langy-test-trigger-${Date.now()}`;
      const before = await listTriggers();
      const beforeIds = new Set(before.map((t) => t.id));

      const result = await runScenarioAndLog({
        name: "create trigger",
        description: `The user wants an alert trigger "${triggerName}" that fires whenever a hallucination evaluation fails.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports successfully creating the trigger.",
              "Langy did not ask for confirmation.",
              "Langy did not redirect the user to a different surface.",
            ],
          }),
        ],
        script: [
          scenario.user(
            `create an alert trigger "${triggerName}" that fires when hallucination evaluation fails`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listTriggers();
      const newOnes = after.filter((t) => !beforeIds.has(t.id));
      console.log(`Layer 2 triggers delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });

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
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listDatasets();
      const created = after.find((d) => !beforeIds.has(d.id));
      console.log(
        `Layer 2 multistep dataset: ${created ? created.name : "NOT FOUND"}`,
      );
      expect(created).toBeTruthy();
    });
  });

  describe("when user asks for a deep-link URL", () => {
    it("returns a LangWatch URL when asked where to find prompts", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "prompts deep-link",
        description:
          "The user asks where to see/manage their prompts in the LangWatch UI.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a concrete LangWatch URL including 'prompts' in the path.",
              "Langy does not respond with vague 'go to settings' instructions.",
              "Langy does not ask which project.",
            ],
          }),
        ],
        script: [
          scenario.user("where in LangWatch can I see my prompts?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns a deep link for datasets surface", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "datasets deep-link",
        description: "The user asks where to browse their datasets in the UI.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a URL that includes 'datasets' in the path.",
              "Langy does not ask which project.",
            ],
          }),
        ],
        script: [
          scenario.user("where can I browse my datasets?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("returns a deep link for scenarios surface", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "scenarios deep-link",
        description:
          "The user asks where to view scenario tests in the LangWatch UI.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returns a URL that includes 'scenarios' in the path.",
            ],
          }),
        ],
        script: [
          scenario.user("where do I see my scenario test results?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the conversation carries session state", () => {
    it("maintains session context across two turns", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "two-turn session memory",
        description:
          "The user asks about traces, then asks a follow-up that only makes sense if the agent remembers turn 1.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy answers turn 2 directly without asking the user to clarify which traces they meant.",
              "Langy's turn-2 answer is concretely about a specific trace's latency.",
            ],
          }),
        ],
        script: [
          scenario.user("show me recent traces"),
          scenario.agent(),
          scenario.user("which one had the highest latency?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
      expect(langy.state.sessionId).toBeTruthy();
    });
  });

  describe("when the conversation spans multiple turns", () => {
    it("multi-turn: discovery then create (3 turns)", async () => {
      const langy = makeLangyAdapter();
      const evaluatorName = `langy-multiturn-eval-${Date.now()}`;
      const before = await listEvaluators();
      const beforeIds = new Set(before.map((e) => e.id));

      const result = await runScenarioAndLog({
        name: "multiturn discover then create",
        description: `Three turns: ask what evaluators exist, ask for recommendation, then say "yes go ahead, name it ${evaluatorName}".`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "On turn 3, Langy actually created an evaluator (not just described one).",
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
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listEvaluators();
      const newOnes = after.filter((e) => !beforeIds.has(e.id));
      console.log(`Layer 2 multiturn eval delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });

    it("multi-turn: trace lookup then drill-down (2 turns)", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "trace lookup drill-down",
        description:
          "Turn 1: ask for recent traces. Turn 2: 'tell me more about the first one'.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "On turn 2, Langy returns details about a SPECIFIC trace (not a generic answer).",
              "Langy did not ask the user 'which trace?' on turn 2.",
            ],
          }),
        ],
        script: [
          scenario.user("show me recent traces"),
          scenario.agent(),
          scenario.user("tell me more about the first one"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
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
          scenario.user(
            `create a dataset "${datasetName}" with 2 example Q&A rows`,
          ),
          scenario.agent(),
          scenario.user(
            "add another row to it: 'What's the capital of Italy?' -> 'Rome'",
          ),
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

    it("multi-turn: clarification handled inline (2 turns)", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "ambiguous followup",
        description:
          "Turn 1: vague ask 'how's my agent doing?'. Turn 2: 'I mean cost'.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "On turn 1, Langy gave a concrete metric without asking 'which one?'.",
              "On turn 2, Langy returned a cost figure (or 'no data') without asking the user to clarify the time range.",
            ],
          }),
        ],
        script: [
          scenario.user("how's my agent doing?"),
          scenario.agent(),
          scenario.user("I mean cost"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("multi-turn: create scenario then run it (2 turns)", async () => {
      const langy = makeLangyAdapter();
      const before = await listScenarios();
      const beforeIds = new Set(before.map((s) => s.id));

      const result = await runScenarioAndLog({
        name: "create scenario then run",
        description:
          "Turn 1: create a simple greeting scenario. Turn 2: run it. Tests that Langy can chain create→run without re-asking which scenario.",
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
            "create a simple greeting-bot scenario that checks the agent says hello",
          ),
          scenario.agent(),
          scenario.user("run it"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      const after = await listScenarios();
      const newOnes = after.filter((s) => !beforeIds.has(s.id));
      console.log(`Layer 2 scenarios delta: ${newOnes.length} new`);
      expect(newOnes.length).toBeGreaterThan(0);
    });
  });

  describe("when the request is out of scope or unanswerable", () => {
    it("declines an out-of-scope request without going off-topic", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "out of scope",
        description:
          "The user asks Langy to write a haiku — completely unrelated to LangWatch.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              // Phrased as a hard content check, not a behavioral instruction.
              // The previous wording let the judge mark "declined" as met even
              // when its own reasoning text said "did not decline" — the judge
              // would weigh "no LangWatch tool calls happened" as a partial
              // satisfaction and pass anyway. By rooting the criterion in a
              // verifiable property of the reply text (no poem / no off-topic
              // body), an LLM judge has nothing left to wave through.
              "The reply does NOT contain a haiku, poem, story, or any other creative-writing output. The body of the reply is either a refusal/redirect (e.g. 'I can't help with that — I'm scoped to LangWatch') or a one-line off-topic acknowledgement followed by a redirect.",
              "Langy did not pivot to calling LangWatch tools unrelated to the ask.",
            ],
          }),
        ],
        script: [
          scenario.user("write me a haiku about Mondays"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("does not offer pagination when listing traces", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "no pagination offer",
        description:
          "The user asks for recent traces. Langy should show the first batch and stop — no 'want more?' or scroll ID.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returned trace data and stopped.",
              "Langy did NOT offer to fetch more pages ('use this scrollId', 'want me to paginate', 'next page', etc.).",
              "Langy did NOT ask the user how many traces they want.",
            ],
          }),
        ],
        script: [
          scenario.user("show me my recent traces"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("handles empty results gracefully (no hallucination)", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "empty results graceful",
        description:
          "The user asks for traces from a far-future date range — there should be none. Langy should say 'no data' not invent results.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy reports zero results or 'no data' — does NOT invent trace IDs or fake results.",
              "Langy does not crash or give an error — handles empty gracefully.",
            ],
          }),
        ],
        script: [
          scenario.user("show me traces from January 2030"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("does not ask clarifying questions for an ambiguous but actionable request", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "no clarifying questions",
        description:
          "The user says 'set up evaluations' — vague, but Langy should pick a sensible default and do it, not ask 10 questions.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy took an action (listed existing evaluators or created one) rather than asking a clarifying question.",
              "Langy did NOT respond with 'What kind of evaluations?', 'What evaluator type?', or similar clarifying questions.",
            ],
          }),
        ],
        script: [
          scenario.user("set up evaluations for me"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    it("does not offer next actions at the end of a response", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "no next actions offered",
        description:
          "After completing a task, Langy should stop. It should not list 'here's what you can do next' options.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy returned the result and stopped — no trailing 'would you like me to...' or 'here are your next options'.",
              "Langy did NOT end with a list of follow-up actions.",
            ],
          }),
        ],
        script: [
          scenario.user("what's my average latency?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when user asks to open a GitHub PR", () => {
    // Unconnected: the worker's github.md skill instructs Langy to emit the
    // `[langy:connect-github]` sentinel so the sidebar can render the in-chat
    // Connect card. We assert the assistant's BEHAVIOR, not the literal
    // sentinel — the judge tolerates wording but rejects "report an error",
    // "give up", or "ask for a PAT".
    //
    // Connected end-to-end (clone → branch → commit → push → PR) is gated
    // behind real credentials + a sandbox repo, so we mark that scenario @e2e
    // in specs/langy/langy-github-prs.feature and run it manually for
    // now. The unconnected path is what regresses if the skill drifts.

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
              "Langy does NOT report an error or stack trace.",
            ],
          }),
        ],
        script: [
          scenario.user(
            "fix the prompt drift in acme/service-x and open a PR for it",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });
});
