/**
 * End-to-end scenario tests for Langy's "How do I improve my agent's
 * latency?" playbook (issue langwatch/langwatch#8178). Binds the six `@e2e`
 * scenarios in `specs/langy/langy-how-do-i-latency.feature`, which are the
 * BDD acceptance block from that issue verbatim (AC8, AC10-13, AC16).
 *
 * Every scenario sends the exact user message
 * "How do I improve my agent's latency?" as the first turn, against a
 * project whose telemetry state is engineered to hit one branch of the
 * playbook:
 *
 * | Scenario | Project | Traces |
 * |---|---|---|
 * | Telemetry not set up | scratch project A | none |
 * | Telemetry set up incorrectly | scratch project B | 12 "broken" spans |
 * | Telemetry correct | the suite's default `PROJECT_ID` | 20 "healthy" spans |
 *
 * Scenarios 1 and 4 share ONE conversation (project A): scenario 4 needs to
 * see the SAME turn's persisted plan that scenario 1 already judged, so its
 * `it()` reads `sharedEmptyProjectAdapter.state.conversationId` set by
 * scenario 1's `it()` rather than starting a second conversation. Same
 * relationship between scenarios 3 and 5 on the default project. Vitest runs
 * `it()`s within a `describe` in declaration order (this suite never uses
 * `.concurrent`), so the ordering the second `it()` in each pair depends on
 * is guaranteed.
 *
 * RUN: needs a live Langy reachable by the adapter. See e2e/langy/README.md.
 *
 *   npx vitest run langy-how-do-i-latency.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
// The plan is derived from the SAME `todowrite` tool parts the panel folds
// into its live checklist (see the module doc in langyPlan.ts) — reusing the
// app's own fold, rather than re-implementing todo-list parsing here, is what
// keeps this suite honest about what the UI actually shows after a reload.
import { type LangyPlan, langyPlan } from "~/features/langy/logic/langyPlan";
import { LANGWATCH_API_KEY, PROJECT_ID } from "./config";
import { seedApplicationTraces } from "./langwatch-api";
import { type LangyAdapter, makeLangyAdapter } from "./langy-agent";
import { LANGY_CORE_RULE_CRITERIA } from "./langy-rules";
import { createScratchProject, type ScratchProject } from "./projects";
import { runScenarioAndLog } from "./scenario-logger";
import { getSessionCookie, trpcQuery } from "./trpc";

const model = openai("gpt-5-mini");
const LATENCY_QUESTION = "How do I improve my agent's latency?";

/**
 * The latest full plan snapshot recorded on a conversation, read the way the
 * panel reads it after a reload: `langy.messages` for the durable transcript,
 * then `langyPlan` folded over each assistant message's tool parts in order,
 * keeping the LAST non-null snapshot (a `todowrite` call rewrites the whole
 * list, so later always wins — see `langyPlan`'s own doc comment).
 *
 * @param conversationId The conversation ID to read the plan from.
 * @param projectId The project ID that the conversation belongs to.
 */
async function readPersistedPlan(
  conversationId: string | null,
  projectId: string,
): Promise<LangyPlan | null> {
  if (!conversationId) throw new Error("the scenario recorded no conversation");
  const { messages } = await trpcQuery<{
    messages: { role: string; parts: readonly unknown[] }[];
  }>({
    cookie: await getSessionCookie(),
    path: "langy.messages",
    input: { projectId, conversationId },
  });

  let plan: LangyPlan | null = null;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const candidate = langyPlan(message);
    if (candidate) plan = candidate;
  }
  return plan;
}

describe("Langy how-do-i: improve my agent's latency", () => {
  // ── Telemetry not set up (+ the prerequisite-branch plan assertion) ──────
  describe("when telemetry is not set up", () => {
    let sharedEmptyProjectAdapter: LangyAdapter;
    let emptyProject: ScratchProject;

    beforeAll(async () => {
      emptyProject = await createScratchProject(`how-do-i-empty-${Date.now()}`);
      sharedEmptyProjectAdapter = makeLangyAdapter({
        projectId: emptyProject.projectId,
      });
      // Deliberately no seeding: this project has zero traces, which is the
      // premise of both scenarios below.
    }, 180_000);

    /** @scenario "Telemetry not set up" */
    it("reports no traces and guides setup, with no latency numbers", async () => {
      const result = await runScenarioAndLog({
        config: {
          name: "how-do-i-latency: no telemetry",
          description:
            "The project has zero traces. The user asks how to improve their agent's latency.",
          agents: [
            sharedEmptyProjectAdapter,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy states clearly that no traces exist in this project.",
                "Langy names the concrete steps to set up tracing: installing the SDK, instrumenting the agent, and where to look once it starts sending data.",
                "Langy gives NO latency number of any kind. Any figure presented with ms, seconds, or a percentile label as a latency measurement fails this criterion, even a placeholder or example number.",
                "Langy does not ask the user a clarifying question before checking whether traces exist — it checks first and reports what it found.",
                ...LANGY_CORE_RULE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.user(LATENCY_QUESTION),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    /** @scenario "The parent goal stays open during a prerequisite branch" */
    it("keeps the goal item open and adds a tracing prerequisite item", async () => {
      const plan = await readPersistedPlan(
        sharedEmptyProjectAdapter.state.conversationId,
        emptyProject.projectId,
      );
      expect(plan, "Langy recorded no plan for this turn").toBeTruthy();
      const items = plan!.items;
      expect(items.length).toBeGreaterThan(0);

      const goal = items[0]!;
      // Smoke check only: the goal item must be about speed. Langy words it from the
      // playbook's Goal sentence ("Find where the agent spends its time ... make it
      // faster"), so the user's word "latency" is not guaranteed to appear.
      expect(goal.content.toLowerCase()).toMatch(
        /latency|faster|slow|spends its time/,
      );
      expect(goal.status).not.toBe("completed");

      const prerequisite = items
        .slice(1)
        .find((item) => /trace|telemetry|tracing/i.test(item.content));
      expect(
        prerequisite,
        `no prerequisite item mentioning traces/telemetry among: ${items.map((i) => i.content).join(" | ")}`,
      ).toBeTruthy();
    });
  });

  // ── Telemetry set up incorrectly ─────────────────────────────────────────
  describe("when telemetry is set up incorrectly", () => {
    let brokenTelemetryAdapter: LangyAdapter;

    beforeAll(async () => {
      const project = await createScratchProject(
        `how-do-i-broken-${Date.now()}`,
      );
      await seedApplicationTraces({
        count: 12,
        apiKey: project.apiKey,
        shape: "broken",
      });
      brokenTelemetryAdapter = makeLangyAdapter({
        projectId: project.projectId,
      });
    }, 180_000);

    /** @scenario "Telemetry set up incorrectly" */
    it("names the missing data and the repair, with no insights on broken spans", async () => {
      const result = await runScenarioAndLog({
        config: {
          name: "how-do-i-latency: broken telemetry",
          description:
            "The project has 12 traces whose spans carry no type, no model, and zero duration. The user asks how to improve their agent's latency.",
          agents: [
            brokenTelemetryAdapter,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy states that traces exist in this project, but that the spans are not usable for a latency analysis.",
                "Langy names at least two of these specific problems: the spans have no type or are untyped, the spans carry no model attribute, or the spans have zero duration (start time equals end time).",
                "Langy names the repair: instrumenting with typed spans that carry real start and end timestamps via the SDK.",
                "Langy presents no p50, p95, average or per-model latency figure as a measurement of the agent. The only latency figure allowed is a zero (0 ms or 0s) named in the same sentence as the words broken, missing, invalid or symptom, and followed by what to repair. Any other millisecond, second or percentile figure fails this criterion.",
                "Langy does NOT rank operations, spans, or models by latency.",
              ],
            }),
          ],
          script: [
            scenario.user(LATENCY_QUESTION),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });
  });

  // ── Telemetry correct (+ the reload-survival plan assertion) ────────────
  describe("when telemetry is correct and spans are good enough for insights", () => {
    let sharedHealthyProjectAdapter: LangyAdapter;

    beforeAll(async () => {
      await seedApplicationTraces({
        count: 20,
        apiKey: LANGWATCH_API_KEY,
        shape: "healthy",
      });
      sharedHealthyProjectAdapter = makeLangyAdapter();
    }, 180_000);

    /** @scenario "Telemetry correct and spans good enough for insights" */
    it("reports latency distribution, slowest operations, and cites evidence", async () => {
      const result = await runScenarioAndLog({
        config: {
          name: "how-do-i-latency: correct telemetry",
          description:
            "The project has 20 traces whose spans carry timing, model, and operation attributes. The user asks how to improve their agent's latency.",
          agents: [
            sharedHealthyProjectAdapter,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "The reply includes p50 and p95 (or an equivalent percentile) latency figures, together with the time window they cover.",
                "The reply names the slowest operations, models, or spans.",
                "The reply cites at least one real trace id as evidence.",
                "The reply gives at least one concrete recommendation tied to that evidence.",
                "The reply does NOT say there is no data.",
              ],
            }),
          ],
          script: [
            scenario.user(LATENCY_QUESTION),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

    /** @scenario "The plan checklist survives a reload" */
    it("persists a checklist that the panel can re-show after a reload", async () => {
      const plan = await readPersistedPlan(
        sharedHealthyProjectAdapter.state.conversationId,
        PROJECT_ID,
      );
      expect(plan, "Langy recorded no plan for this turn").toBeTruthy();
      const items = plan!.items;
      expect(items.length).toBeGreaterThanOrEqual(3); // goal + the playbook's two prerequisite checks
      expect(items[0]!.content.toLowerCase()).toMatch(
        /latency|faster|slow|spends its time/,
      );

      // The healthy branch ends with the whole list done: the skill marks the goal done only when the answer is complete, and the judge scenario above already required that answer.
      expect(plan!.totalCount).toBeGreaterThan(0);
      expect(plan!.completedCount).toBe(plan!.totalCount);
      expect(items[0]!.status).toBe("completed");
    });
  });

  // ── Playbook unavailable — cannot be forced from this harness ──────────
  /**
   * @scenario "The playbook cannot be loaded"
   *
   * Not exercised: forcing this branch means making the baked
   * `improve-agent-latency.mdx` copy under the compiled `how-do-i` skill
   * unavailable AND blocking the worker's network fallback to the docs site,
   * for ONE conversation, without touching any other suite running against
   * the same pod. This harness authenticates against a shared live stack
   * (`makeLangyAdapter`/`config.ts`) and has no lever to delete a file inside
   * the worker's compiled skill set or firewall its egress per-conversation
   * — both require a pod-level change (rebuild the worker image without the
   * baked playbook, or run it with egress blocked) that would affect every
   * other test in this file and every other suite sharing the stack.
   *
   * How this WOULD be proved, outside this harness: build a worker image
   * with `docs/playbooks/how-do-i/improve-agent-latency.mdx` removed before
   * the skill-compile step, run it with outbound network denied (so the docs
   * site fallback also fails), point a `makeLangyAdapter` at that isolated
   * worker, send `LATENCY_QUESTION`, and judge that the reply says the
   * playbook could not be loaded and stops — with no latency guidance
   * anywhere in the same turn (AC16: no improvised procedure).
   */
  // biome-ignore lint/suspicious/noSkippedTests: deferred to #8184; the doc comment above says what would prove it
  it.skip("says the playbook could not be loaded and does not improvise", () => {
    // Intentionally empty — see the doc comment above for why this cannot be
    // forced here, and what would prove it.
  });
});
