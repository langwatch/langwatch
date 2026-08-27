/**
 * Quality regression set for Langy — one scenario per measured production
 * defect, so each one fails today and turns green only when the underlying
 * issue is fixed.
 *
 * Every scenario here was derived from prod Postgres
 * (`LangyConversationTurnProjection`, all-time: 260 completed, 140 failed, 8
 * stopped turns) rather than from a hunch. The mapping is one-to-one:
 *
 *   #1097  10% of successful turns render no answer at all       -> "never ends a turn blank"
 *   #1098  40% zero-tool, 58% under 120 characters               -> "answers from the project, not from memory"
 *   #1099  AGENTS.md:149 calls the working langwatch.* tools     -> "owns the tools it actually has"
 *          hallucinations
 *   #1100  opencode coding-agent persona bleeding through        -> "does not narrate a checkout it never obtained"
 *   #1101  langwatch.monitor.create fails on 48% of calls        -> "a monitor it says it made really exists"
 *   #1102  p90 380s, p99 31min                                   -> "answers a simple question inside the budget"
 *
 * These complement langy-dogfood.scenario.test.ts (named user flows) and
 * langy.scenario.test.ts (broad surface coverage). Kept separate so the
 * quality bar can be run on its own and watched over time.
 *
 * RUN (local haven — all LANGY_* vars already default to the seed identity):
 *
 *   cd platform/app/e2e/langy
 *   npx vitest run langy-quality.scenario.test.ts --reporter=verbose
 *
 * RUN (against Langy's own production project — the measurements above came
 * from prod, so this is where the set is meant to live):
 *
 *   LANGY_APP_URL=https://app.langwatch.ai \
 *   LANGY_PROJECT_ID=<Langy's prod project id> \
 *   LANGY_ADMIN_EMAIL=<a real user on that project> \
 *   LANGY_ADMIN_PASSWORD=<that user's password> \
 *   LW_BASE_URL=https://app.langwatch.ai \
 *   LANGWATCH_API_KEY=<that project's API key> \
 *   OPENAI_API_KEY=<key or gateway virtual key> \
 *   npx vitest run langy-quality.scenario.test.ts --reporter=verbose
 *
 * SIDE EFFECTS: the monitor scenario performs a real create against whichever
 * project is configured, and expects it to SUCCEED — a monitor and an evaluator
 * both appear. Everything this suite creates is named with an `e2e-quality-`
 * prefix. Monitors are deleted afterwards, because a monitor that survives the
 * run keeps evaluating the project's live traffic and costs real money; the
 * evaluator it hangs off is inert and is left behind as the evidence trail.
 */

import { randomUUID } from "node:crypto";
import { openai } from "@ai-sdk/openai";
import type { AgentAdapter, AgentInput, AgentReturnTypes } from "@langwatch/scenario";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteMonitor, listMonitors, seedApplicationTraces } from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_NO_PHANTOM_CHECKOUT_CRITERIA,
  LANGY_OWNS_ITS_TOOLS_CRITERIA,
  LANGY_POLICY_BOUNDARY_CRITERIA,
  LANGY_SOURCED_ANSWER_CRITERIA,
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
 *
 * Unique per run. Teardown deletes what this scenario created, and the only
 * handle it has is the name — so without the suffix, a suite running against a
 * shared project (staging, or Langy's own prod project) would sweep up a
 * monitor another run had just created and is still asserting on.
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
 *
 * Timing the whole `runScenarioAndLog` call would be wrong: it also runs the
 * user simulator, the LLM judge, and a full Playwright browser-QA pass before
 * it returns. Only the adapter's `call` is Langy, and turn duration is exactly
 * what `LangyConversationTurnProjection` measures — so this is the same clock
 * the p90 of 380s came off.
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
  // A fresh local project holds only Langy's own mirrored runs (origin:
  // langy), which rule 27 makes Langy exclude — so every data question would
  // truthfully answer "no traces". Seed real application-origin traffic so
  // the data scenarios have a non-zero ground truth to find.
  // The seed waits for the traces to become QUERYABLE, which can take most of a
  // minute on a cold index — so this timeout has to sit above the seed's own
  // 60s visibility deadline, or vitest kills the hook before it can report the
  // clearer "this is ingestion lag, not a Langy defect" error.
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
   * #1097 — 27 of 260 completed turns have no answer text and made no tool
   * call. The turn is written as `completed`, so it carries no error and never
   * reaches remediation: from every dashboard the platform has, a blank reply
   * looks healthy. AGENTS.md rule 28 forbids it outright.
   *
   * Asserted structurally, not by the judge. A judge grading an empty string
   * can rationalise it as terse; `length === 0` cannot.
   */
  describe("when the user opens with something vague", () => {
    it("never ends a turn with nothing rendered", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "vague opener still gets a visible reply",
          description:
            "The user types a short, low-information opener and then a second one. Neither is a task Langy can act on directly, but both must still produce something the user can read. An empty reply is the failure under test.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Every one of Langy's replies contains readable text — no reply is blank.",
                "Langy responds to the vague opener with something actionable or orienting rather than silence.",
              ],
            }),
          ],
          script: [
            scenario.user("hm"),
            scenario.agent(),
            scenario.user("ok so what now"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      const text = lastAssistantText(result);
      expect(text.length).toBeGreaterThan(0);
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  /**
   * #1098 — 40% of completed turns make zero tool calls and 58% answer in
   * under 120 characters. The question below cannot be answered without
   * querying the project, so an answer that arrives without one is fabricated
   * regardless of how confident it reads.
   */
  describe("when the user asks something only the project data can answer", () => {
    it("answers from the project rather than from the model's memory", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "sourced answer with concrete figures",
          description:
            "The user wants to know what their traffic actually looked like over the last day and where it is going wrong. There is no correct answer that does not come from this project's own traces — a generic explanation of observability is a failure.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: LANGY_SOURCED_ANSWER_CRITERIA,
            }),
          ],
          script: [
            scenario.user(
              "how much traffic did we get in the last 24 hours, and what's the most common thing going wrong?",
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      const text = lastAssistantText(result);
      // A real answer to "how much" carries a number. This catches the
      // confident-but-dataless reply that the judge sometimes lets through.
      expect(text).toMatch(/\d/);
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  /**
   * #1099 — AGENTS.md line 149 tells the model that its own working
   * `langwatch.*` tools are hallucinations. This scenario asks for exactly
   * what `langwatch.trace.search` and `langwatch.analytics.query` serve, and
   * fails if Langy talks itself out of the capability.
   */
  describe("when the answer needs one of the langwatch.* tools", () => {
    it("owns the tools it actually has instead of declaring them unavailable", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        setId: SET_ID,
        name: "does not disown a working capability",
        description:
          "The user asks for a latency figure and a look at recent traces. Both are served by tools Langy uses successfully in production every day. Any reply that says it cannot do this, is not connected, or lacks the integration is the failure under test.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: LANGY_OWNS_ITS_TOOLS_CRITERIA,
          }),
        ],
        script: [
          scenario.user("what's my p95 latency, and show me a few recent traces"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      const text = lastAssistantText(result).toLowerCase();
      // The literal shapes the line-149 instruction pushes the model toward.
      expect(text).not.toMatch(/hallucinat/);
      expect(text).not.toMatch(/no (langwatch )?(mcp|tool|integration)/);
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  /**
   * #1100 — the base system prompt is opencode's coding agent with one word
   * rewritten, while AGENTS.md rule 24 restricts bash to the `langwatch` CLI.
   * Prod shows the coding persona winning sometimes: 144 `read` calls across 7
   * projects, 68 `edit` calls — against a workspace that was never cloned.
   *
   * Source work itself is in scope: AGENTS.md routes "open a PR"/"fix and
   * submit" to the `github` skill, which clones the repository and works there.
   * What must not happen is the narration without the clone — reading a file
   * Langy never obtained, or asking the user to paste it.
   */
  describe("when the user asks Langy to edit source it has not cloned", () => {
    it("does not narrate a checkout it never obtained", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        config: {
          setId: SET_ID,
          name: "does not narrate a checkout it never obtained",
          description:
            "The user asks Langy to open a file in their repository and refactor it, then pushes again when the first answer does not do it. Langy's shell has no copy of that code — it would have to clone the repository first. Going and getting it is a correct answer, and so is saying it does not have the file yet; describing the contents of a file it never obtained is the failure under test.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: LANGY_NO_PHANTOM_CHECKOUT_CRITERIA,
            }),
          ],
          script: [
            scenario.user(
              "open src/agent.py in my project and refactor the retry logic, it's a mess",
            ),
            scenario.agent(),
            scenario.user("just read the file and show me the diff"),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      const text = lastAssistantText(result);
      // A diff or a fenced source block means it played along with the premise.
      expect(text).not.toMatch(/^\s*(diff --git|---\s|\+\+\+\s)/m);
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 600_000);
  });

  /**
   * #1101 — `langwatch.monitor.create` errored on 48% of Langy's calls. Not a
   * flake, and not a boundary either: `POST /api/monitors` demanded
   * `evaluations:manage`, while the tRPC route behind the product's own create
   * button asked for `evaluations:create` and wrote the same `enabled: true`
   * monitor. Langy holds `:create`, so the identical action succeeded in the UI
   * and 403'd for the assistant.
   *
   * Monitors are what customers ask about most, so this scenario is the one
   * that proves the whole flow lands. Layer 2 reads the monitor list back: the
   * judge can be talked into accepting a confident description of a monitor
   * that does not exist, a list diff cannot.
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
      // infrastructure failure and replays the whole script, so a legitimate
      // pass can leave two monitors behind. What matters is that the thing the
      // user asked for exists.
      // Matched on the run-unique name, not merely on "new since `before`":
      // against a shared project another run's monitor is also new, and
      // teardown would delete it out from under the run still asserting on it.
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
   * #1102 — completed turns run p50 24.6s, p90 380.5s, p99 1,868s; 15% take
   * over five minutes. `langwatch/tasks#102` covers the ~23s cold start and
   * states the remainder is inherent agentic time, which is consistent with
   * the p50 but says nothing about the tail.
   *
   * The question below needs one lookup and no reasoning chain. If that cannot
   * land inside two minutes, the tail is not explained by task complexity.
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
});
