/**
 * LangWatch's hosted judge, refused for an organization LangWatch switched hosted off.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import { describe, expect, it } from "vitest";

import { DeterministicInstantEvalJudgeChannel } from "../../channels/memory/memory.instant-eval-judging.channel.ts";
import { InstantEvalHostedSwitchJudgeService } from "../instant-eval-hosted-switch-judge.service.ts";

const REQUEST = {
  projectId: "project-1",
  text: "I am fed up",
  questions: [{ id: "annoyed", kind: "boolean" as const, instructions: "Annoyed?" }],
};

function harness({
  isHostedOff,
  organizationId = "organization-1",
}: {
  isHostedOff: boolean;
  /** Null for a project in no organization. */
  organizationId?: string | null;
}) {
  const hostedCalls: string[] = [];
  const asked: { projectId: string; organizationId: string }[] = [];
  const deterministic = DeterministicInstantEvalJudgeChannel.create();
  const judge = InstantEvalHostedSwitchJudgeService.create({
    hosted: {
      limits: deterministic.limits,
      pricing: deterministic.pricing,
      classify: async (request) => {
        hostedCalls.push(request.projectId);
        return deterministic.classify(request);
      },
      isAvailableForOrganization: async () => true,
    },
    peers: {
      findOrganizationId: async () => organizationId ?? undefined,
      isHostedOff: async (input) => {
        asked.push(input);
        return isHostedOff;
      },
    },
  });
  return { judge, hostedCalls, asked };
}

describe("InstantEvalHostedSwitchJudgeService", () => {
  describe("given an organization with LangWatch's hosted model switched off", () => {
    /** @scenario "LangWatch's hosted judge never classifies for an organization with hosted switched off" */
    it("skips as not configured and never calls the hosted classifier", async () => {
      const { judge, hostedCalls, asked } = harness({ isHostedOff: true });

      const judgement = await judge.classify(REQUEST);

      expect(judgement).toEqual({
        verdicts: [],
        skippedReason: "classifier_not_configured",
        inputTokens: 0,
        isTextTruncated: false,
      });
      expect(hostedCalls).toEqual([]);
      expect(asked).toEqual([{ projectId: "project-1", organizationId: "organization-1" }]);
    });
  });

  describe("given an organization with LangWatch's hosted model not switched off", () => {
    /** @scenario "LangWatch's hosted judge classifies as before for every other organization" */
    it("passes the text to the hosted classifier", async () => {
      const { judge, hostedCalls } = harness({ isHostedOff: false });

      const judgement = await judge.classify(REQUEST);

      expect(hostedCalls).toEqual(["project-1"]);
      expect(judgement.skippedReason).toBeUndefined();
    });

    it("keeps the hosted judge's limits, pricing and availability", async () => {
      const { judge } = harness({ isHostedOff: false });
      const deterministic = DeterministicInstantEvalJudgeChannel.create();

      expect(judge.limits).toEqual(deterministic.limits);
      expect(judge.pricing).toEqual(deterministic.pricing);
      await expect(judge.isAvailableForOrganization("organization-1")).resolves.toBe(true);
    });
  });

  describe("given a project that belongs to no organization", () => {
    it("passes the text on, since no organization rule could name it", async () => {
      const { judge, hostedCalls, asked } = harness({
        isHostedOff: true,
        organizationId: null,
      });

      await judge.classify(REQUEST);

      expect(hostedCalls).toEqual(["project-1"]);
      expect(asked).toEqual([]);
    });
  });
});
