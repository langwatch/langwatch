/**
 * ADR-177 decision 9: an aggregate read folds every member's policy, and one
 * drawer open asks for the protections several times with the same proof.
 * These pin the per-request memo that keeps that to one fold per request.
 */
import {
  EMPTY_AUDIENCE,
  newPrivacyPolicyRequestMemo,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryDataPrivacyPolicyRepository } from "../../repositories/memory/memory.data-privacy.repository.ts";
import { DataPrivacyPolicyCacheService } from "../data-privacy-cache.service.ts";
import { DataPrivacyResolutionService } from "../data-privacy-resolution.service.ts";

const dropping: ResolvedDataPrivacy = {
  ...structuredClone(PLATFORM_DEFAULT_DATA_PRIVACY),
  categories: {
    ...structuredClone(PLATFORM_DEFAULT_DATA_PRIVACY.categories),
    input: { disposition: "drop", audience: { ...EMPTY_AUDIENCE } },
  },
};

const resolutionWith = (resolve: (projectId: string) => Promise<ResolvedDataPrivacy>) => {
  const repository = MemoryDataPrivacyPolicyRepository.create();
  const cache = DataPrivacyPolicyCacheService.create(repository);
  const spy = vi.spyOn(cache, "resolve").mockImplementation(({ projectId }) => resolve(projectId));
  const service = DataPrivacyResolutionService.create({
    repository,
    cache,
    scopes: { getScopeFacts: vi.fn() },
  });
  return { spy, service };
};

const platformDefault = async () => structuredClone(PLATFORM_DEFAULT_DATA_PRIVACY);

describe("DataPrivacyResolutionService.getResolvedForProjects", () => {
  describe("given a request memo", () => {
    describe("when the same projects are asked for twice, in any order", () => {
      it("resolves each project once and returns the same fold", async () => {
        const { spy, service } = resolutionWith(async (projectId) =>
          projectId === "p2" ? dropping : platformDefault(),
        );
        const memo = newPrivacyPolicyRequestMemo();

        const first = await service.getResolvedForProjects({ projectIds: ["p1", "p2"], memo });
        const second = await service.getResolvedForProjects({
          projectIds: ["p2", "p1", "p2"],
          memo,
        });

        expect(second).toBe(first);
        expect(first.categories.input.disposition).toBe("drop");
        expect(spy).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a different set of projects is asked for", () => {
      it("folds that set on its own", async () => {
        const { spy, service } = resolutionWith(platformDefault);
        const memo = newPrivacyPolicyRequestMemo();

        await service.getResolvedForProjects({ projectIds: ["p1", "p2"], memo });
        await service.getResolvedForProjects({ projectIds: ["p1", "p3"], memo });

        expect(spy.mock.calls.map(([input]) => input.projectId)).toEqual(["p1", "p2", "p1", "p3"]);
      });
    });

    describe("when the resolution fails", () => {
      it("does not keep the failure for the next ask", async () => {
        let fail = true;
        const { service } = resolutionWith(async () => {
          if (fail) throw new Error("down");
          return platformDefault();
        });
        const memo = newPrivacyPolicyRequestMemo();

        await expect(
          service.getResolvedForProjects({ projectIds: ["p1", "p2"], memo }),
        ).rejects.toThrow("down");
        fail = false;

        await expect(
          service.getResolvedForProjects({ projectIds: ["p1", "p2"], memo }),
        ).resolves.toEqual(PLATFORM_DEFAULT_DATA_PRIVACY);
      });
    });
  });

  describe("given no memo", () => {
    it("resolves every call afresh", async () => {
      const { spy, service } = resolutionWith(platformDefault);

      await service.getResolvedForProjects({ projectIds: ["p1", "p2"] });
      await service.getResolvedForProjects({ projectIds: ["p1", "p2"] });

      expect(spy).toHaveBeenCalledTimes(4);
    });
  });
});
