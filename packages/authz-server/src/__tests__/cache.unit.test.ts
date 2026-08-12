import { describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService } from "../authz.service";

const ORG = "org-1";

/** A member with zero bindings - enough for the org-role floor to answer,
 *  so every check exercises exactly one collect per cache miss. */
function makeReader(): AuthzReadRepository & {
  collects: () => number;
} {
  const findUserBindings = vi.fn().mockResolvedValue([]);
  return {
    findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
    findUserBindings,
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi.fn().mockResolvedValue(null),
    findTeamOrganization: vi.fn().mockResolvedValue(null),
    collects: () => findUserBindings.mock.calls.length,
  };
}

const alice = { type: "user", id: "alice" } as const;
const orgScope = { type: "organization", id: ORG } as const;

function makeService({
  reader,
  epoch,
  cacheEnabled = true,
}: {
  reader: AuthzReadRepository;
  epoch: () => Promise<number | null>;
  cacheEnabled?: boolean;
}) {
  return new AuthzService(new AuthzCollectorService(reader), {
    epochReader: () => epoch(),
    cacheEnabled: () => cacheEnabled,
  });
}

describe("AuthzService epoch cache", () => {
  describe("given a stable epoch", () => {
    /** @scenario "Repeated checks with unchanged grants read nothing from the database" */
    it("collects once and serves the second read from memory", async () => {
      const reader = makeReader();
      const authz = makeService({
        reader,
        epoch: () => Promise.resolve(4),
      });

      const first = await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      const second = await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(first.allowed).toBe(second.allowed);
      expect(reader.collects()).toBe(1);
    });
  });

  describe("when a grant write bumps the epoch", () => {
    /** @scenario "Revoking a binding takes effect on the caller's next request" */
    it("recollects on the next read", async () => {
      const reader = makeReader();
      let epoch = 4;
      const authz = makeService({
        reader,
        epoch: () => Promise.resolve(epoch),
      });

      await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      epoch = 5;
      await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(reader.collects()).toBe(2);
    });
  });

  describe("when the epoch store is unavailable", () => {
    it("collects fresh every time — never stale, just slower", async () => {
      const reader = makeReader();
      const authz = makeService({
        reader,
        epoch: () => Promise.resolve(null),
      });

      await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(reader.collects()).toBe(2);
    });
  });

  describe("when the flag is off", () => {
    it("bypasses the cache entirely", async () => {
      const reader = makeReader();
      const epoch = vi.fn().mockResolvedValue(4);
      const authz = makeService({
        reader,
        epoch,
        cacheEnabled: false,
      });

      await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });
      await authz.check({
        principal: alice,
        permission: "organization:view",
        scope: orgScope,
      });

      expect(reader.collects()).toBe(2);
      expect(epoch).not.toHaveBeenCalled();
    });
  });
});
