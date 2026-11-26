/**
 * The judge preview endpoint through the REST door: the scenario judge's call answered as its
 * tool call, and each way it is refused, over the composed scenario app with stand-in peers.
 * @see modules/scenario/specs/judge-preview.feature
 */
import { canonicalErrorResponse } from "@langwatch/api/rest";
import type {
  InstantEvalScenarioJudgeAnswer,
  InstantEvalScenarioJudgeCall,
} from "@langwatch/instant-eval-judge-contract";
import { judgePreviewChatCompletionSchema } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { verdictRequest } from "../../__tests__/support/judge-preview-requests.fixture.ts";
import { judgePreviewRest } from "../judge-preview.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  ORGANIZATION_ID,
  PROJECT_ID,
} from "./scenario-rest.harness.ts";

const JUDGED: InstantEvalScenarioJudgeAnswer = {
  outcome: "judged",
  phase: "verdict",
  criteria: [
    { key: "the_agent_offers_a_refund", result: "met" },
    { key: "the_agent_apologises", result: "unmet" },
  ],
  reasoning: "It refunded and never apologised.",
  inputTokens: 900,
  priceUsd: 0.002,
};

async function endpoint({
  answer = JUDGED,
  isSaas = true,
  isFlagOn = true,
  authenticated = true,
}: {
  answer?: InstantEvalScenarioJudgeAnswer;
  isSaas?: boolean;
  isFlagOn?: boolean;
  authenticated?: boolean;
} = {}) {
  const asked: InstantEvalScenarioJudgeCall[] = [];
  const flagChecks: unknown[][] = [];
  const world = await createScenarioRestTestApp({
    isSaas,
    projects: { findOrganizationId: async () => ORGANIZATION_ID },
    featureFlags: {
      isEnabled: async (...check) => {
        flagChecks.push(check);
        return check[0] === "release_langwatch_judge_preview" && isFlagOn;
      },
    },
    judges: {
      isScenarioJudgeConfigured: async () => true,
      judgeScenario: async (call) => {
        asked.push(call);
        return answer;
      },
    },
  });
  const { runtime, projectContext } = createScenarioRestTestRuntime({ authenticated });
  const mounted = runtime.mount(judgePreviewRest.router(), {
    app: () => world.app,
    onError: canonicalErrorResponse,
    middlewareContext: [projectContext],
  });
  const post = (body: unknown = verdictRequest(), signal?: AbortSignal) =>
    mounted.fetch(
      new Request("http://api.test/api/judge-preview/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer run-key" },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      }),
    );
  return { post, asked, flagChecks };
}

describe("POST /api/judge-preview/v1/chat/completions", () => {
  describe("given LangWatch Cloud with the judge preview flag on", () => {
    /** @scenario "The endpoint answers the judge's call through the judge leaf" */
    it("asks the judge leaf for the key's project and answers the finish_test tool call", async () => {
      const { post, asked } = await endpoint();

      const response = await post();
      // The published contract, strictly: the judge's client reads exactly this shape.
      const body = judgePreviewChatCompletionSchema.strict().parse(await response.json());

      expect(response.status).toBe(200);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ projectId: PROJECT_ID, phase: "verdict" });
      expect(body.model).toBe("langwatch/judge-preview");
      const call = body.choices[0]?.message.tool_calls[0]?.function;
      expect(call?.name).toBe("finish_test");
      expect(JSON.parse(call?.arguments ?? "null")).toEqual({
        criteria: {
          the_agent_offers_a_refund: {
            requirement: "The agent offers a refund",
            reasoning: "Met.",
            status: "passed",
          },
          the_agent_apologises: {
            requirement: "The agent apologises",
            reasoning: "Not met.",
            status: "failed",
          },
        },
        reasoning: "It refunded and never apologised.",
      });
    });

    /** @scenario "A caller that disconnects stops the judge's legs" */
    it("asks the judge leaf with a signal that stops when the caller disconnects", async () => {
      const { post, asked } = await endpoint();
      const caller = new AbortController();

      await post(verdictRequest(), caller.signal);
      const signal = asked[0]?.signal;
      expect(signal?.aborted).toBe(false);
      caller.abort();

      expect(signal?.aborted).toBe(true);
    });

    /** @scenario "An unavailable judge is an error, never a verdict" */
    it("answers 503 and no verdict when nothing answered", async () => {
      const { post } = await endpoint({ answer: { outcome: "unavailable" } });

      const response = await post();

      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("tool_calls");
    });

    /** @scenario "A spent free budget is a payment-required error" */
    it("answers 402 with the budget message", async () => {
      const { post } = await endpoint({
        answer: {
          outcome: "refused",
          code: "instant_eval_free_budget_exhausted",
          message: "This organization has used its $1 of free Instant Evals.",
        },
      });

      const response = await post();

      expect(response.status).toBe(402);
      expect(await response.text()).toContain("used its $1 of free Instant Evals");
    });

    /** @scenario "A streamed request is refused" */
    it("answers 400 to a streamed request and to one that is not a judge call", async () => {
      const { post, asked } = await endpoint();

      const streamed = await post({ ...verdictRequest(), stream: true });
      const notJudge = await post({ messages: [{ role: "user", content: "Write a poem" }] });

      expect(streamed.status).toBe(400);
      expect(await streamed.text()).toContain("does not stream");
      expect(notJudge.status).toBe(400);
      expect(asked).toHaveLength(0);
    });
  });

  describe("given the judge preview flag is off for the organization", () => {
    /** @scenario "The endpoint refuses where the judge preview flag is off" */
    it("answers 403 and never asks the judge leaf", async () => {
      const { post, asked } = await endpoint({ isFlagOn: false });

      const response = await post();

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("not turned on for this organization");
      expect(asked).toHaveLength(0);
    });
  });

  describe("given an installation that is not LangWatch Cloud", () => {
    /** @scenario "The endpoint refuses on a self-hosted install" */
    it("answers 403, reads no judge preview flag and never asks the judge leaf", async () => {
      const { post, asked, flagChecks } = await endpoint({ isSaas: false });

      const response = await post();

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("runs on LangWatch Cloud only");
      expect(flagChecks.filter(([key]) => key === "release_langwatch_judge_preview")).toEqual([]);
      expect(asked).toHaveLength(0);
    });
  });

  describe("given a request with no valid key", () => {
    /** @scenario "The endpoint needs a project key" */
    it("answers 401 and never asks the judge leaf", async () => {
      const { post, asked } = await endpoint({ authenticated: false });

      const response = await post();

      expect(response.status).toBe(401);
      expect(asked).toHaveLength(0);
    });
  });
});
