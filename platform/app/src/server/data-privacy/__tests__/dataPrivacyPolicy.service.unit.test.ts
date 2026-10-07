/**
 * ADR-144 decision 9: an aggregate read folds every member's policy, and one
 * drawer open asks for the protections several times with the same proof.
 * These pin the per-request memo that keeps that to one fold per request.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "../dataPrivacy.types";
import type { DataPrivacyPolicyCache } from "../dataPrivacyPolicy.cache";
import { DataPrivacyPolicyService } from "../dataPrivacyPolicy.service";
import { newPrivacyPolicyRequestMemo } from "../privacyPolicyRequestMemo";

const dropping: ResolvedDataPrivacy = {
  ...structuredClone(PLATFORM_DEFAULT_DATA_PRIVACY),
  categories: {
    ...structuredClone(PLATFORM_DEFAULT_DATA_PRIVACY.categories),
    input: { disposition: "drop", audience: { ...EMPTY_AUDIENCE } },
  },
};

const serviceWith = (resolve: DataPrivacyPolicyCache["resolve"]) => {
  const cache = { resolve: vi.fn(resolve) };
  return {
    cache,
    service: new DataPrivacyPolicyService(
      {} as never,
      cache as unknown as DataPrivacyPolicyCache,
    ),
  };
};

describe("DataPrivacyPolicyService.getResolvedForProjects", () => {
  describe("given a request memo", () => {
    describe("when the same projects are asked for twice, in any order", () => {
      it("resolves each project once and returns the same fold", async () => {
        const { cache, service } = serviceWith(async (projectId) =>
          projectId === "p2" ? dropping : null,
        );
        const memo = newPrivacyPolicyRequestMemo();

        const first = await service.getResolvedForProjects({
          projectIds: ["p1", "p2"],
          memo,
        });
        const second = await service.getResolvedForProjects({
          projectIds: ["p2", "p1", "p2"],
          memo,
        });

        expect(second).toBe(first);
        expect(first.categories.input.disposition).toBe("drop");
        expect(cache.resolve).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a different set of projects is asked for", () => {
      it("folds that set on its own", async () => {
        const { cache, service } = serviceWith(async () => null);
        const memo = newPrivacyPolicyRequestMemo();

        await service.getResolvedForProjects({ projectIds: ["p1", "p2"], memo });
        await service.getResolvedForProjects({ projectIds: ["p1", "p3"], memo });

        expect(cache.resolve.mock.calls.map(([id]) => id)).toEqual([
          "p1",
          "p2",
          "p1",
          "p3",
        ]);
      });
    });

    describe("when the resolution fails", () => {
      it("does not keep the failure for the next ask", async () => {
        let fail = true;
        const { service } = serviceWith(async () => {
          if (fail) throw new Error("down");
          return null;
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
      const { cache, service } = serviceWith(async () => null);

      await service.getResolvedForProjects({ projectIds: ["p1", "p2"] });
      await service.getResolvedForProjects({ projectIds: ["p1", "p2"] });

      expect(cache.resolve).toHaveBeenCalledTimes(4);
    });
  });
});
