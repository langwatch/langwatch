/**
 * @vitest-environment node
 *
 * `HIDDEN_SYSTEM_KEY_NAMES` is a tenant-isolation boundary, not a UI filter:
 * `@langwatch/api-key-contract` says membership grants a cross-tenant query
 * bound in `guardOrganizationId`. This repository kept a private copy of the
 * list holding only "Langy session", so a sandbox key was listed to every
 * member of the organization while the service layer refused to let anyone
 * revoke it. These cases pin both listings to the contract's list rather than
 * to today's two names, so a third system name is covered the day it is added.
 */
import { HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";
import { PrismaApiKeyRepository, type PrismaApiKeyDatabase } from "../prisma.api-key.repository";

function repositoryWithSpy() {
  const findMany = vi.fn(async () => []);
  const database = { apiKey: { findMany } } as unknown as PrismaApiKeyDatabase;
  return { repository: PrismaApiKeyRepository.create(database), findMany };
}

type SweepUpdate = {
  where: { name: string; revokedAt: Date | null; expiresAt: { not: null; lte: Date } };
  data: { revokedAt: Date };
};

function repositoryWithUpdateSpy(count = 0) {
  const updateMany = vi.fn(async (_update: SweepUpdate) => ({ count }));
  const database = { apiKey: { updateMany } } as unknown as PrismaApiKeyDatabase;
  return { repository: PrismaApiKeyRepository.create(database), updateMany };
}

function excludedNames(findMany: ReturnType<typeof vi.fn>): string[] {
  const [call] = findMany.mock.calls;
  const where = (call?.[0] as { where?: { name?: { notIn?: string[] } } })?.where;
  return where?.name?.notIn ?? [];
}

describe("PrismaApiKeyRepository", () => {
  describe("when listing an organization's keys", () => {
    it("excludes every system-managed name the contract reserves", async () => {
      const { repository, findMany } = repositoryWithSpy();

      await repository.listForOrganization({ organizationId: "org-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
    });
  });

  describe("when listing one user's keys", () => {
    it("excludes every system-managed name the contract reserves", async () => {
      const { repository, findMany } = repositoryWithSpy();

      await repository.listForUser({ organizationId: "org-1", userId: "user-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
    });
  });

  /**
   * The sweep runs cross-tenant, so every clause below is load-bearing: the
   * name is what keeps it off customer keys, `revokedAt: null` is what stops it
   * rewriting rows it already retired, and `expiresAt: { not: null }` is what
   * keeps a key created without an expiry out of a `lte` comparison.
   */
  describe("when sweeping expired keys of one reserved name", () => {
    /** @scenario "The sandbox sweep revokes only elapsed sandbox keys" */
    it("stamps the elapsed, unrevoked keys of that name as of the sweep's instant", async () => {
      const { repository, updateMany } = repositoryWithUpdateSpy();
      const now = new Date("2026-01-01T00:00:00.000Z");

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now });

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          name: "Agent sandbox run",
          revokedAt: null,
          expiresAt: { not: null, lte: now },
        },
        data: { revokedAt: now },
      });
    });

    /** @scenario "A key with no expiry is never swept" */
    it("requires an expiry to exist before comparing it", async () => {
      const { repository, updateMany } = repositoryWithUpdateSpy();

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now: new Date() });

      const where = updateMany.mock.calls[0]![0].where;
      expect(where.expiresAt).toMatchObject({ not: null });
    });

    /** @scenario "The sandbox sweep leaves live and already-revoked keys alone" */
    it("never reconsiders a key it has already revoked", async () => {
      const { repository, updateMany } = repositoryWithUpdateSpy();

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now: new Date() });

      expect(updateMany.mock.calls[0]![0].where.revokedAt).toBeNull();
    });

    /** @scenario "The sandbox sweep reports how many keys it retired" */
    it("answers the row count Postgres reported", async () => {
      const { repository } = repositoryWithUpdateSpy(3);

      await expect(
        repository.revokeExpiredByName({ name: "Agent sandbox run", now: new Date() }),
      ).resolves.toBe(3);
    });
  });
});
