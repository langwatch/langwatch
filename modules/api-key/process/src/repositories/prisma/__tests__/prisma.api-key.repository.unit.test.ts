/**
 * @vitest-environment node
 *
 * `HIDDEN_SYSTEM_KEY_NAMES` is a tenant-isolation boundary, not a UI filter:
 * these cases pin both listings to the contract's list, not to today's names.
 */
import { HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal, nowInstant, toDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaApiKeyRepository } from "../prisma.api-key.repository.ts";

function repositoryWithSpy() {
  const findMany = vi.fn(async () => []);
  const database = prismaDouble({ apiKey: { findMany } });
  return { repository: PrismaApiKeyRepository.create({ prisma: database }), findMany };
}

function repositoryWithUpdateSpy(count = 0) {
  const updateMany = vi.fn(async (_update: Prisma.ApiKeyUpdateManyArgs) => ({ count }));
  const database = prismaDouble({ apiKey: { updateMany } });
  return { repository: PrismaApiKeyRepository.create({ prisma: database }), updateMany };
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

      await repository.findForOrganization({ organizationId: "org-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
    });
  });

  describe("when listing one user's keys", () => {
    it("excludes every system-managed name the contract reserves", async () => {
      const { repository, findMany } = repositoryWithSpy();

      await repository.findForUser({ organizationId: "org-1", userId: "user-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
    });
  });

  /**
   * The sweep runs cross-tenant, so every clause is load-bearing: the name
   * keeps it off customer keys, `revokedAt: null` stops rewriting retired
   * rows, and `expiresAt: { not: null }` keeps a no-expiry key out of `lte`.
   */
  describe("when sweeping expired keys of one reserved name", () => {
    /** @scenario "The sandbox sweep revokes only elapsed sandbox keys" */
    it("stamps the elapsed, unrevoked keys of that name as of the sweep's instant", async () => {
      const { repository, updateMany } = repositoryWithUpdateSpy();
      const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now });

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          name: "Agent sandbox run",
          revokedAt: null,
          expiresAt: { not: null, lte: toDate(now) },
        },
        data: { revokedAt: toDate(now) },
      });
    });

    /** @scenario "A key with no expiry is never swept" */
    it("requires an expiry to exist before comparing it", async () => {
      const { repository, updateMany } = repositoryWithUpdateSpy();

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now: nowInstant() });

      const where = updateMany.mock.calls[0]![0].where;
      expect(where).toBeDefined();
      expect(where?.expiresAt).toMatchObject({ not: null });
    });

    /** @scenario "The sandbox sweep leaves live and already-revoked keys alone" */
    it("never reconsiders a key it has already revoked", async () => {
      const { repository, updateMany } = repositoryWithUpdateSpy();

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now: nowInstant() });

      expect(updateMany.mock.calls[0]![0].where?.revokedAt).toBeNull();
    });

    /** @scenario "The sandbox sweep reports how many keys it retired" */
    it("answers the row count Postgres reported", async () => {
      const { repository } = repositoryWithUpdateSpy(3);

      await expect(
        repository.revokeExpiredByName({ name: "Agent sandbox run", now: nowInstant() }),
      ).resolves.toBe(3);
    });
  });

  /**
   * `ensureForProject` -> `findIngestKey` once queried ApiKey WITHOUT
   * `organizationId`, so the org-tenancy guard rejected every mint/rotate.
   * Spec: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
   */
  describe("when looking up an organization's ingestion key", () => {
    it("scopes the lookup to the caller's organization", async () => {
      const findFirst = vi.fn(async (_args: unknown) => null);
      const database = prismaDouble({ apiKey: { findFirst } });
      const repository = PrismaApiKeyRepository.create({ prisma: database });

      await repository.findIngestKey({
        organizationId: "org-1",
        apiKeyIds: ["key-1"],
        sourceType: "claude_code",
      });

      const [call] = findFirst.mock.calls;
      const where = (call?.[0] as { where?: { organizationId?: string } })?.where;
      expect(where?.organizationId).toBe("org-1");
    });
  });
});

describe("when a key is revoked", () => {
  /** The revoke's two calls: the fenced SQL write, then the read-back. */
  function revokingRepository(row: { revokedAt: Date | null; revocationCause: string | null }) {
    const $executeRaw = vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (row.revokedAt && sql.join("?").includes('"revokedAt" IS NULL')) return 0;
      row.revokedAt = new Date();
      row.revocationCause = String(values[0]);
      return 1;
    });
    const findUniqueOrThrow = vi.fn(async () => row);
    const database = prismaDouble({
      apiKey: { findUniqueOrThrow },
      $executeRaw: (query, ...values) => {
        if ("sql" in query) throw new Error("the revoke writes through a tagged template");
        return $executeRaw(query, ...values);
      },
    });
    return { repository: PrismaApiKeyRepository.create({ prisma: database }), $executeRaw, row };
  }

  /** @scenario "A revoke from the API keys page records a person as its cause" */
  it("records the cause the caller named, fenced on the row still being live", async () => {
    const { repository, $executeRaw, row } = revokingRepository({
      revokedAt: null,
      revocationCause: null,
    });

    await repository.revoke({ id: "key-1", cause: "user" });

    const [sql, ...values] = $executeRaw.mock.calls[0] ?? [];
    expect(sql?.join("?")).toContain('"revokedAt" IS NULL');
    expect(values).toEqual(["user", "key-1"]);
    expect(row.revocationCause).toBe("user");
  });

  /** @scenario "The first revocation decides the recorded cause" */
  it("leaves the first revocation's cause and moment in place", async () => {
    const { repository, row } = revokingRepository({
      revokedAt: null,
      revocationCause: null,
    });

    await repository.revoke({ id: "key-1", cause: "user" });
    const first = row.revokedAt;
    await repository.revoke({ id: "key-1", cause: "cap" });

    expect(row.revocationCause).toBe("user");
    expect(row.revokedAt).toBe(first);
  });
});
