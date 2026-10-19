/**
 * Quality regression set for Langy: one scenario per measured production
 * defect (`LangyConversationTurnProjection`), failing until fixed. Kept
 * separate from langy-dogfood/langy.scenario so the bar is watched alone.
 */

/**
 * SIDE EFFECTS: creates a real monitor + evaluator (`e2e-quality-*`) against
 * the configured project. The monitor is deleted after — left running it'd
 * evaluate live traffic and cost money; the evaluator stays as evidence.
 */

import { randomUUID } from "node:crypto";

import { openai } from "@ai-sdk/openai";
import type { AgentAdapter, AgentInput, AgentReturnTypes } from "@langwatch/scenario";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMonitor,
  listMonitors,
  seedApplicationTraces,
  seedStaleTraces,
} from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_EMPTY_WINDOW_CRITERIA,
  LANGY_NEVER_RECEIVED_CRITERIA,
  LANGY_POLICY_BOUNDARY_CRITERIA,
} from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";
import { lastAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

/** Groups every run in this file under one Simulation Set in the UI. */
const SET_ID = "langy-quality";

/** Wall-clock budget for a single-lookup question. Prod p90 is 380s. */
const SIMPLE_QUESTION_BUDGET_MS = 120_000;

/**
 * The name the monitor scenario asks for, and looks for afterwards.
 */
const MONITOR_SCENARIO_NAME = `e2e-quality-offtopic-${randomUUID().slice(0, 8)}`;

/**
 * Monitors created during the run, torn down in `afterAll`. A monitor left
 * behind keeps evaluating the project's live traffic on every ingested trace,
 * which spends real money for as long as nobody notices it.
 */
const createdMonitorIds: string[] = [];

/**
 * Wraps the Langy adapter so each turn's own wall-clock is recorded.
 */
function withTurnTimings(adapter: ReturnType<typeof makeLangyAdapter>): {
  adapter: AgentAdapter;
  turnDurationsMs: number[];
} {
  const turnDurationsMs: number[] = [];
  const timed: AgentAdapter = {
    role: adapter.role,
    call: async (input: AgentInput): Promise<AgentReturnTypes> => {
      const startedAt = Date.now();
      try {
        return await adapter.call(input);
      } finally {
        turnDurationsMs.push(Date.now() - startedAt);
      }
    },
  };
  return { adapter: timed, turnDurationsMs };
}

describe("Langy quality bar", () => {
  // A fresh local project holds only Langy's own mirrored runs (origin: langy), which
  // rule 27 makes Langy exclude — so every data question would truthfully answer "no
  // traces".
  beforeAll(async () => {
    await seedApplicationTraces();
  }, 90_000);

  afterAll(async () => {
    // Discovered, not merely recorded. `createdMonitorIds` is appended to only
    // after the scenario returns, so a run that creates the monitor and then
    // throws — a judge failure, a timeout, a transient adapter error — leaves
    // it live with nothing recorded to delete. Teardown therefore re-lists and
    // also matches on the run-unique name.
    const ids = new Set(createdMonitorIds);
    try {
      for (const monitor of await listMonitors()) {
        if (monitor.name?.includes(MONITOR_SCENARIO_NAME)) ids.add(monitor.id);
      }
    } catch (error) {
      // A list that fails must not also cost us the ids we did record.
      console.error("Could not list monitors during teardown:", error);
    }
    await Promise.all([...ids].map((id) => deleteMonitor(id)));
  }, 60_000);

  /**
   * #1101 — `langwatch.monitor.create` errored on 48% of Langy's calls.
   */
  describe("when the user asks for a monitor", () => {
    it("creates the monitor, not just the evaluator", async () => {
      const before = await listMonitors();
      const beforeIds = new Set(before.map((m) => m.id));

      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "monitor create completes end to end",
          description:
            "The user wants to be alerted when their agent starts giving off-topic answers in production. They do not know the difference between an evaluator and a monitor and should not have to — they asked for the outcome, and Langy can deliver all of it.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: LANGY_POLICY_BOUNDARY_CRITERIA,
            }),
          ],
          script: [
            scenario.user(
              `set up a monitor called ${MONITOR_SCENARIO_NAME} that flags production answers that go off-topic`,
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      // `>= 1`, not `=== 1`: runScenarioAndLog retries once on a transient
      // infrastructure failure and replays the whole script, so a legitimate pass can
      // leave two monitors behind.
      const after = await listMonitors();
      const created = after.filter(
        (m) => !beforeIds.has(m.id) && m.name?.includes(MONITOR_SCENARIO_NAME),
      );
      createdMonitorIds.push(...created.map((m) => m.id));
      expect(
        created.length,
        `No monitor named ${MONITOR_SCENARIO_NAME} exists after the run, so whatever Langy said, the user's request was not carried out. Reply was: ${lastAssistantText(result)}`,
      ).toBeGreaterThanOrEqual(1);

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  /**
   * #1102 — completed turns run p50 24.6s, p90 380.5s, p99 1,868s; 15% take over five
   * minutes.
   */
  describe("when the question needs a single lookup", () => {
    it("answers inside the latency budget", async () => {
      const { adapter: langy, turnDurationsMs } = withTurnTimings(makeLangyAdapter());
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "single-lookup question inside the budget",
          description:
            "The user asks one narrow question with a one-command answer. There is nothing here to plan, decompose, or iterate on.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy answers the question with a concrete count or a clear zero.",
                "Langy does NOT expand the narrow question into a broader investigation the user did not ask for. (A sentence of context around the count — e.g. how many succeeded or errored — is proportionate and fine; running extra analyses or a multi-part report is not.)",
              ],
            }),
          ],
          script: [
            scenario.user("how many traces do I have from today?"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      // Without this, an empty `turnDurationsMs` makes `Math.max(0, ...[])`
      // return 0 and the budget assertion passes while measuring nothing —
      // the #1102 guard would report green having never timed a turn.
      expect(
        turnDurationsMs.length,
        "No Langy turn was timed, so the latency budget was never measured.",
      ).toBeGreaterThan(0);

      const slowestTurnMs = Math.max(0, ...turnDurationsMs);
      expect(
        slowestTurnMs,
        `Slowest Langy turn took ${Math.round(slowestTurnMs / 1000)}s for a single-lookup question (all turns: ${turnDurationsMs
          .map((ms) => `${Math.round(ms / 1000)}s`)
          .join(", ")}).`,
      ).toBeLessThan(SIMPLE_QUESTION_BUDGET_MS);

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  /**
   * #8735 — an empty time-bounded result answered "No X in last 24h.", which the
   * user cannot tell from a broken Langy. Langy must look up the newest row in
   * any window and say how old it is.
   */
  describe("when a time-bounded question finds nothing but older data exists", () => {
    /** @scenario An empty window is followed by the age of the newest row */
    /** @scenario An empty window names one likely cause */
    /** @scenario Langy does not claim it cannot see data after a query succeeded */
    it("states how old the newest matching trace is and names a likely cause", async () => {
      const label = `e2e-stale-${randomUUID().slice(0, 8)}`;
      await seedStaleTraces({ label, ageMs: 8 * 60 * 60 * 1000 });

      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "empty window states the age of the newest data",
          description:
            "The project has traces under a unique label, all about 8 hours old. The user asks how many arrived in the last hour. The honest answer is none, plus when the newest one arrived and one likely cause. A bare 'none' or a claim that Langy cannot see the data is the failure under test.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({ model, criteria: LANGY_EMPTY_WINDOW_CRITERIA }),
          ],
          script: [
            scenario.user(`how many traces labelled ${label} did I get in the last hour?`),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      expect(lastAssistantText(result).length).toBeGreaterThan(0);
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);

    /** @scenario A project that never received the data says so */
    it("says the project never received traces with a label it never saw", async () => {
      const label = `e2e-never-${randomUUID().slice(0, 8)}`;

      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "never-received data is said to be never received",
          description:
            "No trace under this label was ever sent to the project. The user asks how many arrived in the last hour. The honest answer is none, that the project never received any, and one likely cause. Inventing a newest trace or claiming Langy cannot see the data is the failure under test.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({ model, criteria: LANGY_NEVER_RECEIVED_CRITERIA }),
          ],
          script: [
            scenario.user(`how many traces labelled ${label} did I get in the last hour?`),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      expect(lastAssistantText(result).length).toBeGreaterThan(0);
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });
});
