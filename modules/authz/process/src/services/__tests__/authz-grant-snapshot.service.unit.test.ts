/**
 * Permission cache security: keyed by organization + epoch, not by cache
 * alone. Failures must fall through to fresh collect, not empty answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthzGrantSnapshotService } from "../authz-grant-snapshot.service.ts";

type Options = {
  cacheEnabled?: boolean;
  epoch?: number | null;
  owner?: { userId: string | null } | null;
  bindings?: { expiresAtMs?: number | null }[];
};

function snapshotWith(options: Options = {}) {
  const collected: { principalId: string; organizationId: string; pass?: number }[] = [];
  let nextEpoch = options.epoch === undefined ? 1 : options.epoch;
  let passes = 0;

  const collector = {
    beginPass: () => ({ pass: ++passes }),
    collectGrants: async ({
      principal,
      organizationId,
      reader,
    }: {
      principal: { id: string };
      organizationId: string;
      reader?: { pass: number };
    }) => {
      collected.push({
        principalId: principal.id,
        organizationId,
        ...(reader ? { pass: reader.pass } : {}),
      });
      return { marker: `${principal.id}@${organizationId}`, bindings: options.bindings ?? [] };
    },
    findApiKeyOwner: async () =>
      options.owner === undefined ? { userId: "user-1" } : options.owner,
    collectResourceGrants: async () => [{ marker: "resource" }],
  };

  const service = AuthzGrantSnapshotService.create(
    collector as never,
    {
      cacheEnabled: () => options.cacheEnabled ?? true,
      epoch: { findEpoch: async () => nextEpoch },
      demoProjectId: () => "demo-project",
    } as never,
  );

  return {
    collected,
    service,
    setEpoch: (value: number | null) => {
      nextEpoch = value;
    },
  };
}

const user = { type: "user" as const, id: "user-1" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AuthzGrantSnapshotService.collectCached", () => {
  describe("given the same caller in two organizations", () => {
    /** @scenario "One member's held answer never answers for another" */
    it("does not serve one organization's grants for the other", async () => {
      const { service, collected } = snapshotWith({});

      const first = await service.collectCached({ principal: user, organizationId: "org-a" });
      const second = await service.collectCached({ principal: user, organizationId: "org-b" });

      expect(first).not.toEqual(second);
      expect(collected).toEqual([
        { principalId: "user-1", organizationId: "org-a" },
        { principalId: "user-1", organizationId: "org-b" },
      ]);
    });
  });

  describe("given two different callers in one organization", () => {
    it("does not serve one caller's grants for the other", async () => {
      const { service, collected } = snapshotWith({});

      await service.collectCached({ principal: user, organizationId: "org-a" });
      await service.collectCached({
        principal: { type: "user", id: "user-2" },
        organizationId: "org-a",
      });

      expect(collected).toHaveLength(2);
    });
  });

  describe("given a repeat read within the same epoch", () => {
    it("answers from the cache, without collecting again", async () => {
      const { service, collected } = snapshotWith({});

      await service.collectCached({ principal: user, organizationId: "org-a" });
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(1);
    });
  });

  describe("given the organization's epoch has moved", () => {
    it("collects again, so a revoked permission stops working", async () => {
      const { service, collected, setEpoch } = snapshotWith({});

      await service.collectCached({ principal: user, organizationId: "org-a" });
      setEpoch(2);
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });
  });

  describe("given a cached grant that expires before the cache's age bound", () => {
    /** @scenario "An expired grant stops granting while its answer is cached" */
    it("collects again once the grant has ended", async () => {
      vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
      const endsAtMs = Date.now() + 1_000;
      const { service, collected } = snapshotWith({ bindings: [{ expiresAtMs: endsAtMs }] });

      await service.collectCached({ principal: user, organizationId: "org-a" });
      vi.setSystemTime(endsAtMs - 1);
      await service.collectCached({ principal: user, organizationId: "org-a" });
      expect(collected).toHaveLength(1);

      vi.setSystemTime(endsAtMs);
      await service.collectCached({ principal: user, organizationId: "org-a" });
      expect(collected).toHaveLength(2);
    });
  });

  describe("given an entry older than the cache's age bound", () => {
    /** @scenario "A held answer is never served indefinitely" */
    it("collects again, even though the epoch has not moved", async () => {
      // The epoch is the primary invalidation. This is the backstop for
      // whatever fails to bump it.
      const { service, collected } = snapshotWith({});

      await service.collectCached({ principal: user, organizationId: "org-a" });
      vi.advanceTimersByTime(30_001);
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });

    it("still answers from the cache just inside the bound", async () => {
      const { service, collected } = snapshotWith({});

      await service.collectCached({ principal: user, organizationId: "org-a" });
      vi.advanceTimersByTime(29_000);
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(1);
    });
  });

  describe("given an anonymous caller", () => {
    it("never caches them", async () => {
      const { service, collected } = snapshotWith({});
      const anonymous = { type: "anonymous" as const, id: "anonymous" };

      await service.collectCached({ principal: anonymous, organizationId: "org-a" });
      await service.collectCached({ principal: anonymous, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });
  });

  describe("given the cache is turned off", () => {
    /** @scenario "An operator turns the grants cache off" */
    it("collects every time", async () => {
      const { service, collected } = snapshotWith({ cacheEnabled: false });

      await service.collectCached({ principal: user, organizationId: "org-a" });
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });
  });

  describe("given the epoch cannot be read", () => {
    /** @scenario "Checks stay correct when the change signal cannot be read" */
    it("collects fresh rather than trusting whatever it already had", async () => {
      const { service, collected } = snapshotWith({ epoch: null });

      await service.collectCached({ principal: user, organizationId: "org-a" });
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });
  });
});

describe("AuthzGrantSnapshotService.collectWithOwnerCeiling", () => {
  describe("given a principal that is not an API key", () => {
    it("has no owner to cap it", async () => {
      const { service } = snapshotWith({});

      const { ownerGrants } = await service.collectWithOwnerCeiling({
        principal: user,
        organizationId: "org-a",
      });

      expect(ownerGrants).toBeNull();
    });
  });

  describe("given an API key with an owner", () => {
    it("answers with the key's grants capped by the owner's", async () => {
      const { service, collected } = snapshotWith({});

      const answer = await service.collectWithOwnerCeiling({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: "org-a",
      });

      expect(answer).toEqual({
        grants: { marker: "key-1@org-a", bindings: [] },
        ownerGrants: { marker: "user-1@org-a", bindings: [] },
      });
      expect(collected.map(({ principalId }) => principalId)).toEqual(["key-1", "user-1"]);
    });

    it("skips the owner when the caller asks for no ceiling", async () => {
      const { service, collected } = snapshotWith({});

      const { ownerGrants } = await service.collectWithOwnerCeiling({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: "org-a",
        ceiling: false,
      });

      expect(ownerGrants).toBeNull();
      expect(collected.map(({ principalId }) => principalId)).toEqual(["key-1"]);
    });
  });

  describe("given an API key nobody owns", () => {
    it("has nothing to cap it, rather than collecting for a null user", async () => {
      const { service, collected } = snapshotWith({ owner: { userId: null } });

      const { ownerGrants } = await service.collectWithOwnerCeiling({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: "org-a",
      });

      expect(ownerGrants).toBeNull();
      expect(collected.map(({ principalId }) => principalId)).toEqual(["key-1"]);
    });
  });

  describe.each([
    ["the grants cache is off", { cacheEnabled: false }],
    ["the change signal cannot be read", { epoch: null }],
  ])("when %s", (_when, options: Options) => {
    it("reads the key and its owner on one pass", async () => {
      const { service, collected } = snapshotWith(options);

      await service.collectWithOwnerCeiling({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: "org-a",
      });

      expect(collected.map(({ pass }) => pass)).toEqual([1, 1]);
    });
  });

  describe("when the cache serves", () => {
    it("collects without opening a pass", async () => {
      const { service, collected } = snapshotWith({});

      await service.collectWithOwnerCeiling({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: "org-a",
      });

      expect(collected.map(({ pass }) => pass)).toEqual([undefined, undefined]);
    });
  });
});

describe("AuthzGrantSnapshotService.findResourceGrantsFor", () => {
  describe("given a scope that is not a resource", () => {
    it("answers with nothing to say, rather than an empty grant list", async () => {
      // undefined and [] mean different things to the caller: one is "this
      // question does not apply", the other is "asked, and the answer is none".
      const { service } = snapshotWith({});

      await expect(
        service.findResourceGrantsFor({ type: "organization", id: "org-a" } as never),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a resource scope", () => {
    it("collects its grants", async () => {
      const { service } = snapshotWith({});

      await expect(
        service.findResourceGrantsFor({ type: "resource", id: "resource-1" } as never),
      ).resolves.toEqual([{ marker: "resource" }]);
    });
  });
});
