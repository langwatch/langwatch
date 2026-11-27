/**
 * One call of the scenario judge on LangWatch Judge (preview), answered through the judge leaf or
 * refused by name.
 * @see modules/scenario/specs/judge-preview.feature
 */
import type {
  InstantEvalJudgeApi,
  InstantEvalScenarioJudgeAnswer,
  InstantEvalScenarioJudgeCall,
} from "@langwatch/instant-eval-judge-contract";
import {
  JudgePreviewBudgetExhaustedError,
  JudgePreviewNotAvailableError,
  JudgePreviewRequestInvalidError,
  JudgePreviewUnavailableError,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { verdictRequest } from "../../../../__tests__/support/judge-preview-requests.fixture.ts";
import { judgePreviewAvailabilityFixture } from "../../../../__tests__/support/judge-preview.fixture.ts";
import { JUDGE_PREVIEW_NOT_ON_CLOUD } from "../judge-preview-availability.service.ts";
import { JudgePreviewChatService } from "../judge-preview-chat.service.ts";

const PROJECT_ID = "project-1";

const JUDGED: InstantEvalScenarioJudgeAnswer = {
  outcome: "judged",
  phase: "verdict",
  criteria: [
    { key: "the_agent_offers_a_refund", result: "met" },
    { key: "the_agent_apologises", result: "met" },
  ],
  inputTokens: 900,
  priceUsd: 0.002,
};

function chat({
  answer = JUDGED,
  isSaas = true,
  isFlagOn = true,
  isConfigured = true,
}: {
  answer?: InstantEvalScenarioJudgeAnswer;
  isSaas?: boolean;
  isFlagOn?: boolean;
  isConfigured?: boolean;
} = {}) {
  const asked: InstantEvalScenarioJudgeCall[] = [];
  const flagChecks: unknown[][] = [];
  const service = JudgePreviewChatService.create({
    judges: createApiFixture<InstantEvalJudgeApi>({
      judgeScenario: async (call) => {
        asked.push(call);
        return answer;
      },
    }),
    availability: judgePreviewAvailabilityFixture({ isSaas, isFlagOn, isConfigured, flagChecks }),
    ids: { next: () => "id-1" },
    clock: { now: () => Temporal.Instant.fromEpochMilliseconds(1_760_000_000_500) },
  });
  const complete = (signal?: AbortSignal, request = verdictRequest()) =>
    service.complete({
      projectId: PROJECT_ID,
      request,
      ...(signal ? { signal } : {}),
    });
  return { complete, asked, flagChecks };
}

describe("JudgePreviewChatService", () => {
  describe("given LangWatch Cloud with the judge preview flag on", () => {
    /** @scenario "The endpoint answers the judge's call through the judge leaf" */
    it("asks the judge leaf once for the project and answers the finish_test tool call", async () => {
      const { complete, asked } = chat();

      const completion = await complete();

      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ projectId: PROJECT_ID, phase: "verdict" });
      expect(asked[0]?.criteria.map((criterion) => criterion.key)).toEqual([
        "the_agent_offers_a_refund",
        "the_agent_apologises",
      ]);
      expect(completion).toMatchObject({ id: "chatcmpl_id-1", created: 1_760_000_000 });
      expect(completion.choices[0]?.message.tool_calls[0]?.function.name).toBe("finish_test");
    });

    /** @scenario "A verdict call that offers the one-shot wait for traces is answered with that wait" */
    it("answers the offered wait without asking the judge leaf, then judges the next call", async () => {
      const { complete, asked, flagChecks } = chat();

      const waited = await complete(undefined, verdictRequest({ extraTools: ["wait_for_traces"] }));
      expect(asked).toHaveLength(0);
      expect(flagChecks).toHaveLength(1);
      expect(waited.choices[0]?.message.tool_calls[0]?.function).toEqual({
        name: "wait_for_traces",
        arguments: "{}",
      });
      expect(waited.usage.total_tokens).toBe(0);

      const judged = await complete();
      expect(asked).toHaveLength(1);
      expect(judged.choices[0]?.message.tool_calls[0]?.function.name).toBe("finish_test");
    });

    /** @scenario "A caller that disconnects stops the judge's legs" */
    it("passes the request's stop signal to the judge leaf", async () => {
      const { complete, asked } = chat();
      const stop = new AbortController();

      await complete(stop.signal);

      expect(asked[0]?.signal).toBe(stop.signal);
    });

    /** @scenario "An unavailable judge is an error, never a verdict" */
    it("throws the unavailable error when nothing answered", async () => {
      const { complete } = chat({ answer: { outcome: "unavailable" } });

      await expect(complete()).rejects.toBeInstanceOf(JudgePreviewUnavailableError);
      await expect(complete()).rejects.toMatchObject({ httpStatus: 503 });
    });

    /** @scenario "A spent free budget is a payment-required error" */
    it("throws the budget error with the leaf's message", async () => {
      const { complete } = chat({
        answer: {
          outcome: "refused",
          code: "instant_eval_free_budget_exhausted",
          message: "This organization has used its $1 of free Instant Evals.",
        },
      });

      await expect(complete()).rejects.toBeInstanceOf(JudgePreviewBudgetExhaustedError);
      await expect(complete()).rejects.toMatchObject({
        httpStatus: 402,
        message: "This organization has used its $1 of free Instant Evals.",
      });
    });

    /** @scenario "A project the judge has not learned is refused at the endpoint" */
    it("throws not available, in its own words, for a project the leaf has not learned", async () => {
      const { complete } = chat({
        answer: {
          outcome: "refused",
          code: "instant_eval_project_unknown",
          message: "Instant Evals has not learned this project yet, so it judged nothing.",
        },
      });

      await expect(complete()).rejects.toMatchObject({
        httpStatus: 403,
        message: expect.stringContaining("LangWatch Judge (preview) has not learned this project"),
      });
    });

    /** @scenario "A not-on-Cloud answer from the judge leaf is refused in the words used before a run" */
    it("refuses in the same words as before a run when the leaf says it is not on Cloud", async () => {
      const { complete } = chat({
        answer: {
          outcome: "refused",
          code: "classifier_not_configured",
          message: "Instant Evals is not configured.",
        },
      });

      await expect(complete()).rejects.toMatchObject({
        httpStatus: 403,
        message: JUDGE_PREVIEW_NOT_ON_CLOUD,
      });
    });
  });

  describe("given the judge preview flag is off for the organization", () => {
    /** @scenario "The endpoint refuses where the judge preview flag is off" */
    it("throws not available and never asks the judge leaf", async () => {
      const { complete, asked } = chat({ isFlagOn: false });

      await expect(complete()).rejects.toBeInstanceOf(JudgePreviewNotAvailableError);
      expect(asked).toHaveLength(0);
    });

    /** @scenario "A verdict call that offers the one-shot wait for traces is answered with that wait" */
    it("refuses a wait where the judge preview is not available, as any call", async () => {
      const { complete } = chat({ isFlagOn: false });

      await expect(
        complete(undefined, verdictRequest({ extraTools: ["wait_for_traces"] })),
      ).rejects.toBeInstanceOf(JudgePreviewNotAvailableError);
    });
  });

  describe("given a judge route table that names no turn decision backend", () => {
    /** @scenario "A run on LangWatch Judge (preview) is refused before it starts where it is not set up" */
    it("throws not available, saying it is not set up, and never asks the judge leaf", async () => {
      const { complete, asked } = chat({ isConfigured: false });

      await expect(complete()).rejects.toMatchObject({
        httpStatus: 403,
        message: expect.stringMatching(/is not set up on this installation.*Pick another/),
      });
      expect(asked).toHaveLength(0);
    });
  });

  describe("given an installation that is not LangWatch Cloud", () => {
    /** @scenario "The endpoint refuses on a self-hosted install" */
    it("throws not available, reads no flag and never asks the judge leaf", async () => {
      const { complete, asked, flagChecks } = chat({ isSaas: false, isFlagOn: true });

      await expect(complete()).rejects.toMatchObject({
        httpStatus: 403,
        message: expect.stringContaining("runs on LangWatch Cloud only"),
      });
      expect(flagChecks).toHaveLength(0);
      expect(asked).toHaveLength(0);
    });
  });

  describe("given a request that is not a judge call", () => {
    const notAJudgeCall = { messages: [{ role: "user" as const, content: "hello" }] };

    /** @scenario "A request that is not a scenario judge call is refused" */
    it("refuses it as invalid once availability is read, before the judge leaf is asked", async () => {
      const { complete, asked, flagChecks } = chat();

      await expect(complete(undefined, notAJudgeCall)).rejects.toBeInstanceOf(
        JudgePreviewRequestInvalidError,
      );
      expect(flagChecks).toHaveLength(1);
      expect(asked).toHaveLength(0);
    });

    /** @scenario "Where the judge preview is not available a malformed call is refused as not available" */
    it.each([
      ["the flag is off", { isFlagOn: false }],
      ["the install is not LangWatch Cloud", { isSaas: false }],
    ])("answers 403, not 400, where %s, for a malformed or streamed call", async (_, setup) => {
      const { complete, asked } = chat(setup);

      for (const request of [notAJudgeCall, { ...verdictRequest(), stream: true }]) {
        await expect(complete(undefined, request)).rejects.toMatchObject({ httpStatus: 403 });
      }
      expect(asked).toHaveLength(0);
    });
  });
});
