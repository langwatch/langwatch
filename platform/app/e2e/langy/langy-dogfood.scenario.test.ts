/**
 * Dogfood scenario set for Langy: the two flows called out in the ADR-050 ask:
 * "user asks to find failing traces" and "user asks to open a PR", plus a
 * multi-turn drill-down. These exercise Langy end-to-end with LangWatch's own
 * `@langwatch/scenario` tooling: a user simulator drives the conversation and an
 * LLM judge grades the response against Langy's own rules (see langy-rules.ts).
 *
 * This complements the broad surface coverage in langy.scenario.test.ts; it is
 * kept separate so the two named flows are easy to run in isolation.
 *
 * RUN: needs a live Langy reachable by the adapter. See e2e/langy/README.md.
 *
 *   LANGY_AGENT_URL=<langy endpoint> \
 *   OPENAI_API_KEY=<virtual-key> OPENAI_BASE_URL=<gateway>/v1 \
 *   npx vitest run langy-dogfood.scenario.test.ts --reporter=verbose
 *
 * With LANGWATCH_API_KEY + LANGWATCH_ENDPOINT set (in THIS test process only,
 * never the platform process, per langwatchPlatformGuard), @langwatch/scenario
 * also reports each run into the platform's simulations UI.
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
import { LANGWATCH_API_KEY, LW_BASE_URL } from "./config";
import { listDatasets, traceExists } from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_ACTIVITY_OVERVIEW_CRITERIA,
  LANGY_CORE_RULE_CRITERIA,
  LANGY_EVAL_CREATION_CRITERIA,
  LANGY_FAILING_TRACES_CRITERIA,
  LANGY_GREETING_CRITERIA,
  LANGY_OPEN_PR_CRITERIA,
} from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

/**
 * The failing-traces flows need errored APPLICATION traces to exist: Langy
 * correctly excludes simulation/langy origins (its own runs and this suite's),
 * so on a clean project "no failed traces" is a true answer and the drill
 * scenario has nothing to drill into.
 *
 * The ids carry a minute stamp so a re-run within the same minute is an upsert
 * and a later one seeds fresh traces. They used to be fixed, which looked
 * tidier and quietly corrupted the data: a trace summary keeps the EARLIEST
 * start it was ever posted, so every re-post widened the same trace instead of
 * replacing it. After a day of runs the fixtures reported `total_time_ms` of
 * 71,170,357 (19.8 hours) against spans that say 60 seconds, and Langy spent a
 * paragraph of every reply correctly flagging the instrumentation anomaly we
 * had seeded.
 */
const FIXTURE_RUN_STAMP = String(Math.floor(Date.now() / 60_000));

async function seedFailingApplicationTraces(): Promise<void> {
  const now = Date.now();
  const fixtures = [
    {
      traceId: `langy-dogfood-error-timeout-${FIXTURE_RUN_STAMP}`,
      user: "Summarize the quarterly report for the board.",
      error:
        "OpenAI request timed out after 60000ms (model gpt-5-mini, attempt 2 of 2)",
      startedAt: now - 50 * 60 * 1000,
      durationMs: 60_000,
    },
    {
      traceId: `langy-dogfood-error-schema-${FIXTURE_RUN_STAMP}`,
      user: "Extract the invoice fields as JSON.",
      error:
        'Output validation failed: expected key "total_amount" missing from model response',
      startedAt: now - 30 * 60 * 1000,
      durationMs: 2_400,
    },
  ];
  for (const f of fixtures) {
    const res = await fetch(`${LW_BASE_URL}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": LANGWATCH_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trace_id: f.traceId,
        spans: [
          {
            type: "llm",
            span_id: `${f.traceId}-llm`,
            name: "chat-completion",
            model: "gpt-5-mini",
            input: {
              type: "chat_messages",
              value: [{ role: "user", content: f.user }],
            },
            error: {
              has_error: true,
              message: f.error,
              stacktrace: [],
            },
            timestamps: {
              started_at: f.startedAt,
              finished_at: f.startedAt + f.durationMs,
            },
          },
        ],
        metadata: {
          user_id: "langy-dogfood-fixture",
          thread_id: "langy-dogfood-fixture",
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(
        `Seeding errored trace ${f.traceId} failed: ${res.status} ${await res.text()}`,
      );
    }
  }
  // The collector queues into the async pipeline; the traces only exist for
  // Langy once the workers have projected them. Poll for that rather than
  // sleeping a fixed interval: projection is usually quick, but on a loaded
  // machine it can outlast any constant, and the failing-trace scenarios then
  // run against data that is not searchable yet.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const projected = await Promise.all(
      fixtures.map((f) => traceExists(f.traceId)),
    );
    if (projected.every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    "Seeded fixture traces were still not searchable after 45s: the collector pipeline is behind, so the failing-trace scenarios would grade Langy against missing data",
  );
}

describe("Langy dogfood: named flows", () => {
  beforeAll(async () => {
    await seedFailingApplicationTraces();
  }, 90_000);

  describe("when the user just says hi", () => {
    /** @scenario A greeting gets a friendly hello, never a refusal */
    it("greets back and introduces itself instead of refusing", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "greeting gets a friendly hello",
        description:
          "The user opens the conversation with a bare greeting and then asks who the assistant is. Neither message is a task, so neither may be refused.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({ model, criteria: LANGY_GREETING_CRITERIA }),
        ],
        script: [
          scenario.user("hi"),
          scenario.agent(),
          scenario.user("who are you?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks what their agent has been up to on a project with traces but no evaluations", () => {
    /** @scenario An open "what has my agent been up to?" is answered from traces, not a dead end */
    it("describes the trace activity and invites a deeper dig instead of stopping at empty evaluations", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "activity overview from traces, not a dead end",
        description:
          "The project has production traces but no evaluation runs. The user asks an open question about what their agent has been doing. An answer that stops at 'no evaluation data' is a failure; the reply must describe the actual traffic and end by inviting the user to pick what to dig into.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: LANGY_ACTIVITY_OVERVIEW_CRITERIA,
          }),
        ],
        script: [
          scenario.user("heeey, what has my agent been up to?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks to find failing traces", () => {
    /** @scenario A scenario checks that Langy finds and summarises failing traces */
    it("finds the failing traces and summarises them in one turn", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "find and summarise failing traces",
        description:
          "The user suspects something is broken and wants to see which traces failed recently, then understand why.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: LANGY_FAILING_TRACES_CRITERIA,
          }),
        ],
        script: [
          scenario.user(
            "find my failing traces from the last day and tell me what's going wrong",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);

      // Layer 2: the seeded fixture traces the reply reports on really exist,
      // through the same REST surface any integration uses. Grounding is a
      // hard fact, so it is asserted here, not delegated to the LLM judge.
      expect(
        await traceExists(`langy-dogfood-error-timeout-${FIXTURE_RUN_STAMP}`),
      ).toBe(true);
      expect(
        await traceExists(`langy-dogfood-error-schema-${FIXTURE_RUN_STAMP}`),
      ).toBe(true);
    });

    /** @scenario A multi-turn scenario checks that Langy drills in using prior context */
    it("drills into the worst failing trace on a follow-up turn using prior context", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "drill into a failing trace across turns",
        description:
          "After listing failing traces, the user wants more detail on the most severe one without repeating its id.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "On the follow-up, Langy drills into a specific trace it already surfaced (using the concrete id from the prior turn), rather than re-listing or asking which one.",
              ...LANGY_FAILING_TRACES_CRITERIA,
            ],
          }),
        ],
        script: [
          scenario.user("show me my failed traces"),
          scenario.agent(),
          scenario.user("tell me more about the worst one"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks for an eval without saying which kind", () => {
    /** @scenario An ambiguous "make me an eval" is asked about before anything is created */
    it("asks experiment-vs-evaluator first, then creates the right resource with a valid body", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "make me an eval, ask before creating",
        description:
          "The user wants 'an eval' without saying whether they mean a batch experiment or an online evaluator. The choice picks what gets tested, so Langy must ask before creating anything; once answered, the create must go through with a type the platform accepts.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: LANGY_EVAL_CREATION_CRITERIA,
          }),
        ],
        script: [
          scenario.user("make me an eval"),
          scenario.agent(),
          // The answer picks the online side and names relevancy. The exact
          // shape that once lured the agent into the stale
          // "ragas/answer_relevancy" slug. If it reaches for it again, the
          // error now carries the accepted types and the judge requires the
          // corrected retry to happen inside the turn.
          scenario.user(
            "score my live production traffic, I want to know when answers go off-topic",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks to open a PR", () => {
    /** @scenario A scenario checks that Langy opens a pull request */
    it("opens a pull request via the github skill without asking for credentials", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "open a pull request",
        description:
          "The user wants a small change landed in one of their repositories as a pull request.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({ model, criteria: LANGY_OPEN_PR_CRITERIA }),
        ],
        script: [
          scenario.user(
            "open a PR on my repo that adds a one-line note to the README saying LangWatch is set up",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    /**
     * The connected-project pair of the scenario above: with a GitHub App
     * installed, the flow must end with a real PR URL. The local stack has no
     * GitHub connection to test against, so this stays skipped until the suite
     * gets a connected fixture project.
     */
    // biome-ignore lint/suspicious/noSkippedTests: the fixture project has no GitHub App, so this pair documents the connected path until one exists
    it.skip("opens a real PR and reports its URL on a connected project", () => {
      throw new Error("needs a project with the GitHub App installed");
    });
  });

  describe("when the user asks for a dataset to be created", () => {
    /** @scenario A completed write ends with a visible next-step line */
    it("creates the dataset and closes with a short line pointing forward", async () => {
      const langy = makeLangyAdapter();
      // A leftover dataset with this name turns the scenario's create into an
      // "already exists" reply and fails it for the wrong reason.
      const stale = (await listDatasets()).filter(
        (d) => d.name === "langy-dogfood-reply-check",
      );
      await Promise.all(
        stale.map((d) =>
          fetch(`${LW_BASE_URL}/api/dataset/${d.id}`, {
            method: "DELETE",
            headers: { "X-Auth-Token": LANGWATCH_API_KEY },
          }),
        ),
      );
      const before = await listDatasets();
      const beforeIds = new Set(before.map((d) => d.id));
      const result = await runScenarioAndLog({
        name: "write flows end with a visible next step",
        description:
          "The user asks for a dataset. The platform renders the creation itself as a card, so the reply's job is one short line the user can act on next, and a reply with no visible text at all is a failure even when the card exists.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy's reply names the dataset it created (the name alone is enough; ids and column lists belong to the card, not the reply).",
              "Langy's final reply contains at least one visible line of text. A reply that is empty or whitespace-only fails this scenario.",
              "The final reply is short and reads as the answer: naming the dataset and the columns the user asked for is fine, reciting ids or reading like a work log is not: it states the change or points forward.",
              ...LANGY_CORE_RULE_CRITERIA,
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a dataset called langy-dogfood-reply-check with columns question and answer",
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
      // The name matters, not just that something appeared: a dataset under any
      // other name means Langy wrote the wrong thing, or a concurrent run wrote
      // it, and either way this scenario did not prove what it claims.
      expect(created?.name).toBe("langy-dogfood-reply-check");
    });
  });

  describe("when the user just says thanks after an answer", () => {
    /** @scenario A bare acknowledgment gets a visible reply, not silence */
    it("acknowledges the thanks with a short visible line", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "thanks gets a visible acknowledgment",
        description:
          "After a normal question, the user just says thanks. The turn carries no task, so the reply is one short friendly line, never an empty turn, and never a refusal.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy's reply to the bare 'thanks!' is visible text. An empty reply fails this scenario.",
              "The acknowledgment is one short friendly line, without starting new work the user did not ask for.",
              "Langy does NOT decline the thanks, in any wording, and does not tell the user it is out of scope.",
            ],
          }),
        ],
        script: [
          scenario.user("how many traces do I have from the last day?"),
          scenario.agent(),
          scenario.user("thanks!"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  describe("when the user asks for something outside LangWatch", () => {
    /** @scenario An out-of-scope request is declined in one line */
    it("declines a kubernetes runbook in one short line without producing any of it", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "out-of-scope request declined in one line",
        description:
          "The user asks for an infrastructure runbook that has nothing to do with LangWatch. The right answer is a one-line decline: no partial runbook, no kubectl commands, and no lecture.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              "Langy declines the request in a single short line rather than producing the runbook.",
              "The reply contains no kubectl commands, no shell for outside infrastructure, and no step-by-step runbook content, in any framing.",
              "The decline stays plain and friendly, no lecture about policies and no wall of text.",
            ],
          }),
        ],
        script: [
          scenario.user(
            "write me a kubectl runbook to restart my production pods when they get stuck",
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
