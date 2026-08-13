import { ALL_PERMISSIONS, type CollectedBinding } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService, type AuthzServiceOptions } from "../authz.service";
import { makeReader } from "./support/authz-read.stub";

const ORG = "org-1";
const OTHER_ORG = "org-2";

const alice = { type: "user", id: "alice" } as const;
const bob = { type: "user", id: "bob" } as const;
const orgScope = { type: "organization", id: ORG } as const;
const otherOrgScope = { type: "organization", id: OTHER_ORG } as const;

/** A member with zero bindings - enough for the org-role floor to answer,
 *  so every check exercises exactly one collect per cache miss. Bindings
 *  are read through a getter so a test can revoke mid-run. */
function makeMemberReader(bindings: () => CollectedBinding[] = () => []) {
  const reader = makeReader({
    findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
    findUserBindings: vi.fn(() => Promise.resolve(bindings())),
  });
  return {
    reader,
    collects: () => reader.findUserBindings.mock.calls.length,
  };
}

function makeService({
  reader,
  epoch,
  cacheEnabled = true,
  cacheMaxAgeMs,
}: {
  reader: AuthzReadRepository;
  epoch: () => Promise<number | null>;
  cacheEnabled?: boolean;
  cacheMaxAgeMs?: AuthzServiceOptions["cacheMaxAgeMs"];
}) {
  return new AuthzService(new AuthzCollectorService(reader), {
    epochReader: () => epoch(),
    cacheEnabled: () => cacheEnabled,
    cacheMaxAgeMs,
  });
}

/** The oracle a cached answer is compared against: the same reader, a
 *  service that has never cached anything. */
function makeUncachedService(reader: AuthzReadRepository) {
  return new AuthzService(new AuthzCollectorService(reader));
}

describe("AuthzService epoch cache", () => {
  describe("given a stable epoch", () => {
    /** @scenario "Repeated checks with unchanged grants read nothing from the database" */
    it("serves every permission from one collect, matching a fresh resolution", async () => {
      const { reader, collects } = makeMemberReader();
      const authz = makeService({ reader, epoch: () => Promise.resolve(4) });

      const cached: boolean[] = [];
      for (const permission of ALL_PERMISSIONS) {
        cached.push(
          await authz.can({ principal: alice, permission, scope: orgScope }),
        );
      }
      expect(collects()).toBe(1);

      const fresh = makeUncachedService(makeMemberReader().reader);
      const expected: boolean[] = [];
      for (const permission of ALL_PERMISSIONS) {
        expected.push(
          await fresh.can({ principal: alice, permission, scope: orgScope }),
        );
      }
      expect(cached).toEqual(expected);
      expect(cached).toContain(true);
    });

    it("keys entries per principal and per organization", async () => {
      const { reader, collects } = makeMemberReader();
      const authz = makeService({ reader, epoch: () => Promise.resolve(4) });

      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.can({
        principal: bob,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: otherOrgScope,
      });
      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      // Three distinct (principal, organization) pairs, and the repeat of
      // the first one hits.
      expect(collects()).toBe(3);
    });
  });

  describe("when a grant write bumps the epoch", () => {
    /** @scenario "Revoking a binding takes effect on the caller's next request" */
    it("denies the permission the revoked binding carried", async () => {
      let bindings: CollectedBinding[] = [
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: ORG,
          viaGroupId: null,
        },
      ];
      const { reader, collects } = makeMemberReader(() => bindings);
      let epoch = 4;
      const authz = makeService({
        reader,
        epoch: () => Promise.resolve(epoch),
      });

      const before = await authz.can({
        principal: alice,
        permission: "organization:manage",
        scope: orgScope,
      });
      expect(before).toBe(true);

      // The admin revokes: storage loses the row and the write bumps the
      // epoch, which is the only thing telling the cache to look again.
      bindings = [];
      epoch = 5;

      const after = await authz.can({
        principal: alice,
        permission: "organization:manage",
        scope: orgScope,
      });
      expect(after).toBe(false);
      expect(collects()).toBe(2);
    });
  });

  describe("when an entry outlives the absolute age bound", () => {
    it("recollects even though the epoch never moved", async () => {
      const { reader, collects } = makeMemberReader();
      const authz = makeService({
        reader,
        epoch: () => Promise.resolve(4),
        cacheMaxAgeMs: 50,
      });

      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(collects()).toBe(2);
    });

    it("still serves an entry that is inside the bound", async () => {
      const { reader, collects } = makeMemberReader();
      const authz = makeService({
        reader,
        epoch: () => Promise.resolve(4),
        cacheMaxAgeMs: 10_000,
      });

      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(collects()).toBe(1);
    });
  });

  describe("when the epoch store is unavailable", () => {
    it("collects fresh every time — never stale, just slower", async () => {
      const { reader, collects } = makeMemberReader();
      const authz = makeService({ reader, epoch: () => Promise.resolve(null) });

      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(collects()).toBe(2);
    });
  });

  describe("when the flag is off", () => {
    it("bypasses the cache entirely", async () => {
      const { reader, collects } = makeMemberReader();
      const epoch = vi.fn().mockResolvedValue(4);
      const authz = makeService({ reader, epoch, cacheEnabled: false });

      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.can({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(collects()).toBe(2);
      expect(epoch).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is anonymous", () => {
    it("never reads the epoch and never caches — the snapshot is constant", async () => {
      const { reader } = makeMemberReader();
      const epoch = vi.fn().mockResolvedValue(4);
      const authz = makeService({ reader, epoch });

      await authz.can({
        principal: { type: "anonymous" },
        permission: "organization:view",
        scope: orgScope,
      });

      expect(epoch).not.toHaveBeenCalled();
      expect(reader.findOrganizationRole).not.toHaveBeenCalled();
    });
  });
});
