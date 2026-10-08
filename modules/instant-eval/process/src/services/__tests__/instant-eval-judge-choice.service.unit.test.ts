/**
 * The judge chosen on the first call, since the key is the Instant Evals judge's and a peer Api
 * cannot be asked at startup (ADR-174 decision 13).
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import {
  instantEvalSkipped,
  type InstantEvalJudgeApi,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it, vi } from "vitest";

import type { InstantEvalJudgeChannel } from "../../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalJudgeChannel } from "../../channels/memory/memory.instant-eval-judge.channel.ts";
import { InstantEvalCloudJudgeService } from "../instant-eval-cloud-judge.service.ts";
import { InstantEvalJudgeChoiceService } from "../instant-eval-judge-choice.service.ts";

const REQUEST = { projectId: "project-1", text: "hello", questions: [] };

describe("given a judge chosen on its first call", () => {
  describe("when it is asked twice", () => {
    it("chooses once", async () => {
      const choose = vi.fn(async (): Promise<InstantEvalJudgeChannel> => {
        return MemoryInstantEvalJudgeChannel.create();
      });
      const judge = InstantEvalJudgeChoiceService.create({ choose });

      await judge.classify(REQUEST);
      await judge.classify(REQUEST);

      expect(choose).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the first choice fails", () => {
    it("asks again on the next call", async () => {
      const choose = vi
        .fn<() => Promise<InstantEvalJudgeChannel>>()
        .mockRejectedValueOnce(new Error("judge not ready"))
        .mockResolvedValue(MemoryInstantEvalJudgeChannel.create());
      const judge = InstantEvalJudgeChoiceService.create({ choose });

      await expect(judge.classify(REQUEST)).rejects.toThrow("judge not ready");
      await expect(judge.classify(REQUEST)).resolves.toMatchObject({
        skippedReason: "classifier_not_configured",
      });
    });
  });

  describe("when it chose LangWatch's key", () => {
    it("judges for every organization and classifies through the Instant Evals judge", async () => {
      const classify = vi.fn<InstantEvalJudgeApi["classify"]>(async () =>
        instantEvalSkipped("classifier_rate_limited"),
      );
      const judge = InstantEvalJudgeChoiceService.create({
        choose: async () => InstantEvalCloudJudgeService.create({ judges: { classify } }),
      });

      await expect(judge.isAvailableForOrganization("organization-1")).resolves.toBe(true);
      await judge.classify(REQUEST);

      expect(classify).toHaveBeenCalledWith(REQUEST);
    });
  });
});
