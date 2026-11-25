/**
 * LangWatch Judge (preview) for a scenario run: where it may judge, the parameters a run's judge
 * gets, and one call answered through the judge leaf or refused by name.
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
import { JudgePreviewChatService } from "../judge-preview-chat.service.ts";
import { JudgePreviewModelParametersService } from "../judge-preview-model-parameters.service.ts";

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
}: {
  answer?: InstantEvalScenarioJudgeAnswer;
  isSaas?: boolean;
  isFlagOn?: boolean;
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
    availability: judgePreviewAvailabilityFixture({ isSaas, isFlagOn, flagChecks }),
    ids: { next: () => "id-1" },
    clock: { now: () => Temporal.Instant.fromEpochMilliseconds(1_760_000_000_500) },
  });
  const complete = () => service.complete({ projectId: PROJECT_ID, request: verdictRequest() });
  return { complete, asked, flagChecks };
}

describe("JudgePreviewAvailabilityService", () => {
  /** @scenario "The flag is read for the project within its organization" */
  it("reads the release flag for the project within its organization", async () => {
    const flagChecks: unknown[][] = [];
    const availability = judgePreviewAvailabilityFixture({
      isSaas: true,
      isFlagOn: true,
      organizationId: "organization-9",
      flagChecks,
    });

    const answer = await availability.availabilityFor({ projectId: PROJECT_ID });

    expect(answer).toEqual({ isAvailable: true });
    expect(flagChecks).toEqual([
      [
        "release_langwatch_judge_preview",
        { kind: "project", projectId: PROJECT_ID, organizationId: "organization-9" },
      ],
    ]);
  });

  it("is unavailable for a project with no organization, which no rule could name", async () => {
    const availability = judgePreviewAvailabilityFixture({
      isSaas: true,
      isFlagOn: true,
      organizationId: null,
    });

    const answer = await availability.availabilityFor({ projectId: PROJECT_ID });

    expect(answer).toMatchObject({ isAvailable: false });
  });
});

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
  });

  describe("given the judge preview flag is off for the organization", () => {
    /** @scenario "The endpoint refuses where the judge preview flag is off" */
    it("throws not available and never asks the judge leaf", async () => {
      const { complete, asked } = chat({ isFlagOn: false });

      await expect(complete()).rejects.toBeInstanceOf(JudgePreviewNotAvailableError);
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

  it("refuses a request that is not a judge call before anything is asked", async () => {
    const { asked, flagChecks } = chat();
    const service = JudgePreviewChatService.create({
      judges: createApiFixture<InstantEvalJudgeApi>(),
      availability: judgePreviewAvailabilityFixture({ isSaas: true, isFlagOn: true, flagChecks }),
      ids: { next: () => "id-1" },
      clock: { now: () => Temporal.Instant.fromEpochMilliseconds(0) },
    });

    await expect(
      service.complete({
        projectId: PROJECT_ID,
        request: { messages: [{ role: "user", content: "hello" }] },
      }),
    ).rejects.toBeInstanceOf(JudgePreviewRequestInvalidError);
    expect(asked).toHaveLength(0);
    expect(flagChecks).toHaveLength(0);
  });
});

describe("JudgePreviewModelParametersService", () => {
  const prepare = ({
    isSaas = true,
    isFlagOn = true,
    langwatchEndpoint = "https://app.langwatch.test/",
  } = {}) =>
    JudgePreviewModelParametersService.create({
      availability: judgePreviewAvailabilityFixture({ isSaas, isFlagOn }),
      langwatchEndpoint,
    }).prepare({ projectId: PROJECT_ID, runKey: "run-key-1" });

  /** @scenario "A run judged by LangWatch Judge (preview) is pointed at the app's own endpoint" */
  it("names the OpenAI-shaped model, the app's judge preview address and the run's key", async () => {
    await expect(prepare()).resolves.toEqual({
      success: true,
      params: {
        model: "openai/langwatch-judge-preview",
        api_base: "https://app.langwatch.test/api/judge-preview/v1",
        api_key: "run-key-1",
      },
    });
  });

  /** @scenario "A run on LangWatch Judge (preview) is refused before it starts where it may not judge" */
  it("refuses on a self-hosted install and with the flag off, saying what to pick instead", async () => {
    const selfHosted = await prepare({ isSaas: false });
    const flagOff = await prepare({ isFlagOn: false });

    expect(selfHosted).toMatchObject({
      success: false,
      message: expect.stringMatching(
        /LangWatch Judge \(preview\) runs on LangWatch Cloud only.*Pick another judge model/,
      ),
    });
    expect(flagOff).toMatchObject({
      success: false,
      message: expect.stringMatching(
        /LangWatch Judge \(preview\) is not turned on.*Pick another judge model/,
      ),
    });
  });

  it("refuses when the installation's own address is not configured", async () => {
    await expect(prepare({ langwatchEndpoint: "" })).resolves.toMatchObject({
      success: false,
      reason: "missing_params",
    });
  });
});
