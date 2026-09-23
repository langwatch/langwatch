import type { ConnectClassifyAnswer } from "@langwatch/enterprise-licensing-contract";
import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  type InstantEvalPricing,
} from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  ConnectInstantEvalJudgeService,
  CONNECT_JUDGE_STATE_TTL_MS,
} from "../connect-instant-eval-judge.service.ts";

const PRICING: InstantEvalPricing = { usdPerMillionInputTokens: 0.042, markup: 1.3 };

const ANSWER: ConnectClassifyAnswer = {
  verdicts: [{ questionId: "q1", probability: 0.9 }],
  inputTokens: 120,
  isTextTruncated: false,
  chargedUsd: 0.0001,
};

function harness(
  options: { enabled?: boolean; organizationIds?: string[]; answer?: ConnectClassifyAnswer } = {},
) {
  const calls = { enabledReads: 0, classifies: 0 };
  let clock = 0;
  const judge = ConnectInstantEvalJudgeService.create({
    licensing: {
      isConnectServiceEnabled: async () => {
        calls.enabledReads += 1;
        return options.enabled ?? true;
      },
      classifyThroughConnect: async () => {
        calls.classifies += 1;
        return options.answer ?? ANSWER;
      },
    },
    projects: {
      findOrganizationIdsForProject: async () => options.organizationIds ?? ["org-acme"],
    },
    pricing: PRICING,
    limits: INSTANT_EVAL_CLASSIFIER_LIMITS,
    now: () => clock,
  });
  return { judge, calls, tick: (ms: number) => void (clock += ms) };
}

describe("the hosted Instant Evals judge", () => {
  it("judges through LangWatch for an entitled organization", async () => {
    const { judge, calls } = harness();

    await expect(
      judge.classify({ projectId: "project-1", text: "hello", questions: [] }),
    ).resolves.toEqual({
      verdicts: [{ questionId: "q1", probability: 0.9 }],
      inputTokens: 120,
      isTextTruncated: false,
    });
    expect(calls.classifies).toBe(1);
  });

  it("skips rather than fails where the service is off, sending nothing", async () => {
    const { judge, calls } = harness({ enabled: false });

    await expect(
      judge.classify({ projectId: "project-1", text: "hello", questions: [] }),
    ).resolves.toEqual({
      verdicts: [],
      skippedReason: "classifier_not_configured",
      inputTokens: 0,
      isTextTruncated: false,
    });
    expect(calls.classifies).toBe(0);
  });

  it("skips a project no organization claims", async () => {
    const { judge, calls } = harness({ organizationIds: [] });

    await expect(
      judge.classify({ projectId: "unknown", text: "hello", questions: [] }),
    ).resolves.toMatchObject({ skippedReason: "classifier_not_configured" });
    expect(calls.enabledReads).toBe(0);
    expect(calls.classifies).toBe(0);
  });

  it("carries back only a skip reason this side knows", async () => {
    const { judge } = harness({
      answer: { ...ANSWER, skippedReason: "something_new_over_there", inputTokens: 0 },
    });

    await expect(
      judge.classify({ projectId: "project-1", text: "hello", questions: [] }),
    ).resolves.not.toHaveProperty("skippedReason");
  });

  it("names the host's own skip reason where it is one of ours", async () => {
    const { judge } = harness({
      answer: { ...ANSWER, skippedReason: "classifier_rate_limited", inputTokens: 0 },
    });

    await expect(
      judge.classify({ projectId: "project-1", text: "hello", questions: [] }),
    ).resolves.toMatchObject({ skippedReason: "classifier_rate_limited" });
  });

  it("reads the entitlement once for a run of many judgements", async () => {
    const { judge, calls } = harness();

    for (let text = 0; text < 5; text += 1) {
      await judge.classify({ projectId: "project-1", text: `t${text}`, questions: [] });
    }

    expect(calls.enabledReads).toBe(1);
    expect(calls.classifies).toBe(5);
  });

  it("reads it again once the held answer is older than its window", async () => {
    const { judge, calls, tick } = harness();

    await judge.classify({ projectId: "project-1", text: "one", questions: [] });
    tick(CONNECT_JUDGE_STATE_TTL_MS);
    await judge.classify({ projectId: "project-1", text: "two", questions: [] });

    expect(calls.enabledReads).toBe(2);
  });

  it("states Instant Evals' own rate and limits rather than any of its own", () => {
    const { judge } = harness();

    expect(judge.pricing).toEqual(PRICING);
    expect(judge.limits).toBe(INSTANT_EVAL_CLASSIFIER_LIMITS);
  });
});
