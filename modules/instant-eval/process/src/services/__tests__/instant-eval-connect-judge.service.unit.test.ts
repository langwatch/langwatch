/**
 * The hosted judge on a connected install: judged through licensing where the organization has
 * the service on, skipped with nothing sent where it has not, and the opt-in re-read on a window.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import type { ConnectClassifyAnswer } from "@langwatch/enterprise-licensing-contract";
import { INSTANT_EVAL_CLASSIFIER_LIMITS } from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalJudgeKind } from "../../rules/instant-eval-judge-choice.rules.ts";
import { INSTANT_EVAL_PRICING } from "../../rules/instant-eval-pricing.rules.ts";
import {
  CONNECT_JUDGE_STATE_TTL_MS,
  InstantEvalConnectJudgeService,
} from "../instant-eval-connect-judge.service.ts";

const ANSWER: ConnectClassifyAnswer = {
  verdicts: [{ questionId: "q1", probability: 0.9 }],
  inputTokens: 120,
  isTextTruncated: false,
  chargedUsd: 0.0001,
};

const REQUEST = { projectId: "project-1", text: "hello", questions: [] };

function harness(
  options: { enabled?: boolean; organizationId?: string; answer?: ConnectClassifyAnswer } = {},
) {
  const calls = { enabledReads: 0, classifies: 0 };
  const state = { enabled: options.enabled ?? true, clockMs: 0 };
  const judge = InstantEvalConnectJudgeService.create({
    licensing: {
      isConnectServiceEnabled: async () => {
        calls.enabledReads += 1;
        return state.enabled;
      },
      classifyThroughConnect: async () => {
        calls.classifies += 1;
        return options.answer ?? ANSWER;
      },
    },
    projects: {
      findOrganizationId: async () =>
        "organizationId" in options ? options.organizationId : "org-acme",
    },
    now: () => Temporal.Instant.fromEpochMilliseconds(state.clockMs),
  });
  return { judge, calls, state };
}

describe("the Connect judge", () => {
  it("judges through LangWatch for an organization with the service on", async () => {
    const { judge, calls } = harness();

    await expect(judge.classify(REQUEST)).resolves.toEqual({
      verdicts: [{ questionId: "q1", probability: 0.9 }],
      inputTokens: 120,
      isTextTruncated: false,
    });
    expect(calls.classifies).toBe(1);
  });

  it("skips rather than fails where the service is off, sending nothing", async () => {
    const { judge, calls } = harness({ enabled: false });

    await expect(judge.classify(REQUEST)).resolves.toMatchObject({
      verdicts: [],
      skippedReason: "classifier_not_configured",
    });
    expect(calls.classifies).toBe(0);
  });

  it("skips a project no organization claims without asking licensing", async () => {
    const { judge, calls } = harness({ organizationId: undefined });

    await expect(judge.classify(REQUEST)).resolves.toMatchObject({
      skippedReason: "classifier_not_configured",
    });
    expect(calls.enabledReads).toBe(0);
    expect(calls.classifies).toBe(0);
  });

  it("carries back only a skip reason this side knows", async () => {
    const unknown = harness({ answer: { ...ANSWER, skippedReason: "something_new" } });
    const known = harness({ answer: { ...ANSWER, skippedReason: "classifier_rate_limited" } });

    await expect(unknown.judge.classify(REQUEST)).resolves.not.toHaveProperty("skippedReason");
    await expect(known.judge.classify(REQUEST)).resolves.toMatchObject({
      skippedReason: "classifier_rate_limited",
    });
  });

  it("reads the opt-in once for a run of many judgements", async () => {
    const { judge, calls } = harness();

    for (let text = 0; text < 5; text += 1) {
      await judge.classify({ ...REQUEST, text: `t${text}` });
    }

    expect(calls.enabledReads).toBe(1);
    expect(calls.classifies).toBe(5);
  });

  /** @scenario "Switching the service on takes effect without a restart" */
  it("judges the next text through LangWatch once the held opt-in is older than its window", async () => {
    const { judge, calls, state } = harness({ enabled: false });
    await expect(judge.isAvailableForOrganization("org-acme")).resolves.toBe(false);

    state.enabled = true;
    state.clockMs += CONNECT_JUDGE_STATE_TTL_MS;

    await expect(judge.classify(REQUEST)).resolves.not.toHaveProperty("skippedReason");
    expect(calls.classifies).toBe(1);
  });

  /** @scenario "An install that sets nothing new keeps the classifier it had" */
  it("is what an install with no key and no settings judges with, and sends nothing unlicensed", async () => {
    const { judge, calls } = harness({ enabled: false });

    expect(
      instantEvalJudgeKind({ classifier: undefined, hasOwnKey: false, isProduction: false }),
    ).toBe("connect");
    await expect(judge.classify(REQUEST)).resolves.toMatchObject({
      skippedReason: "classifier_not_configured",
    });
    expect(calls.classifies).toBe(0);
  });

  it("states Instant Evals' own rate and limits", () => {
    const { judge } = harness();

    expect(judge.pricing).toEqual(INSTANT_EVAL_PRICING);
    expect(judge.limits).toBe(INSTANT_EVAL_CLASSIFIER_LIMITS);
  });
});
