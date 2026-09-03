/**
 * The permission cache.
 *
 * Two ways this goes wrong and both are security bugs rather than performance
 * ones: a key that does not separate organizations serves one tenant's grants
 * to another, and an invalidation that does not fire keeps a revoked
 * permission working. The epoch is what makes a revocation take effect, and
 * the age bound is the backstop for when the epoch itself is not moving.
 *
 * Everything else here is a deliberate refusal to cache — anonymous callers,
 * a disabled cache, an unreadable epoch — and each has to fall through to a
 * fresh collection rather than to an empty answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzGrantSnapshotService } from "../authz-grant-snapshot.service";

type Options = {
  cacheEnabled?: boolean;
  epoch?: number | null;
  owner?: { userId: string | null } | null;
};

function snapshotWith(options: Options = {}) {
  const collected: Array<{ principalId: string; organizationId: string }> = [];
  let nextEpoch = options.epoch === undefined ? 1 : options.epoch;

  const collector = {
    collectGrants: async ({
      principal,
      organizationId,
    }: {
      principal: { id: string };
      organizationId: string;
    }) => {
      collected.push({ principalId: principal.id, organizationId });
      return { marker: `${principal.id}@${organizationId}` };
    },
    tryFindApiKeyOwner: async () =>
      options.owner === undefined ? { userId: "user-1" } : options.owner,
    collectResourceGrants: async () => [{ marker: "resource" }],
  };

  const service = AuthzGrantSnapshotService.create(
    collector as never,
    {
      cacheEnabled: () => options.cacheEnabled ?? true,
      epoch: { tryRead: async () => nextEpoch },
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

  describe("given an entry older than the cache's age bound", () => {
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
    it("collects every time", async () => {
      const { service, collected } = snapshotWith({ cacheEnabled: false });

      await service.collectCached({ principal: user, organizationId: "org-a" });
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });
  });

  describe("given the epoch cannot be read", () => {
    it("collects fresh rather than trusting whatever it already had", async () => {
      const { service, collected } = snapshotWith({ epoch: null });

      await service.collectCached({ principal: user, organizationId: "org-a" });
      await service.collectCached({ principal: user, organizationId: "org-a" });

      expect(collected).toHaveLength(2);
    });
  });
});

describe("AuthzGrantSnapshotService.tryOwnerGrantsFor", () => {
  describe("given a principal that is not an API key", () => {
    it("has no owner to fall back to", async () => {
      const { service } = snapshotWith({});

      await expect(
        service.tryOwnerGrantsFor({ principal: user, organizationId: "org-a" }),
      ).resolves.toBeNull();
    });
  });

  describe("given an API key with an owner", () => {
    it("answers with the owner's grants, not the key's", async () => {
      const { service, collected } = snapshotWith({});

      const grants = await service.tryOwnerGrantsFor({
        principal: { type: "apiKey", id: "key-1" },
        organizationId: "org-a",
      });

      expect(grants).toEqual({ marker: "user-1@org-a" });
      expect(collected).toEqual([{ principalId: "user-1", organizationId: "org-a" }]);
    });
  });

  describe("given an API key nobody owns", () => {
    it("has nothing to fall back to, rather than collecting for a null user", async () => {
      const { service, collected } = snapshotWith({ owner: { userId: null } });

      await expect(
        service.tryOwnerGrantsFor({
          principal: { type: "apiKey", id: "key-1" },
          organizationId: "org-a",
        }),
      ).resolves.toBeNull();
      expect(collected).toHaveLength(0);
    });
  });
});

describe("AuthzGrantSnapshotService.tryResourceGrantsFor", () => {
  describe("given a scope that is not a resource", () => {
    it("answers with nothing to say, rather than an empty grant list", async () => {
      // undefined and [] mean different things to the caller: one is "this
      // question does not apply", the other is "asked, and the answer is none".
      const { service } = snapshotWith({});

      await expect(
        service.tryResourceGrantsFor({ type: "organization", id: "org-a" } as never),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a resource scope", () => {
    it("collects its grants", async () => {
      const { service } = snapshotWith({});

      await expect(
        service.tryResourceGrantsFor({ type: "resource", id: "resource-1" } as never),
      ).resolves.toEqual([{ marker: "resource" }]);
    });
  });
});
