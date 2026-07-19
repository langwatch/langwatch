/**
 * Dogfood scenario set for Langy — the two flows called out in the ADR-050 ask:
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
 * With LANGWATCH_API_KEY + LANGWATCH_ENDPOINT set (in THIS test process only —
 * never the platform process, per langwatchPlatformGuard), @langwatch/scenario
 * also reports each run into the platform's simulations UI.
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_FAILING_TRACES_CRITERIA,
  LANGY_OPEN_PR_CRITERIA,
} from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

describe("Langy dogfood — named flows", () => {
  describe("when the user asks to find failing traces", () => {
    it("finds the failing traces and summarises them in one turn", async () => {
      const langy = makeLangyAdapter();
      const result = await runScenarioAndLog({
        name: "find and summarise failing traces",
        description:
          "The user suspects something is broken and wants to see which traces failed recently, then understand why.",
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({ model, criteria: LANGY_FAILING_TRACES_CRITERIA }),
        ],
        script: [
          scenario.user("find my failing traces from the last day and tell me what's going wrong"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    });

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

  describe("when the user asks to open a PR", () => {
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
  });
});
