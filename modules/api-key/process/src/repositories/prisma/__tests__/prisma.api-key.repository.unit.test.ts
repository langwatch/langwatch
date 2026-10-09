/**
 * @vitest-environment node
 *
 * `HIDDEN_SYSTEM_KEY_NAMES` is a tenant-isolation boundary, not a UI filter:
 * these cases pin both listings to the contract's list, not to today's names.
 */
import {
  CLI_LOGIN_KEY_NAME_PREFIX,
  HIDDEN_SYSTEM_KEY_NAMES,
  WORKFLOW_RUN_API_KEY_NAME,
} from "@langwatch/api-key-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { Temporal, nowInstant, toDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaApiKeyRepository } from "../prisma.api-key.repository.ts";

function repositoryWithSpy() {
  const findMany = vi.fn(async () => []);
  const database = prismaDouble({ apiKey: { findMany } });
  return { repository: PrismaApiKeyRepository.create({ prisma: database }), findMany };
}

function repositoryWithSweepSpy(count = 0) {
  const sweep = vi.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => count);
  const database = prismaDouble({
    $executeRaw: (query, ...values) => {
      if ("sql" in query) throw new Error("the sweep writes through a tagged template");
      return sweep(query, ...values);
    },
  });
  return { repository: PrismaApiKeyRepository.create({ prisma: database }), sweep };
}

function sweptSql(sweep: ReturnType<typeof repositoryWithSweepSpy>["sweep"]) {
  const [sql, ...values] = sweep.mock.calls[0] ?? [];
  return { text: sql?.join("?") ?? "", values };
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
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isSystemManaged: false }) }),
      );
    });
  });

  describe("when listing one user's keys", () => {
    it("excludes every system-managed name the contract reserves", async () => {
      const { repository, findMany } = repositoryWithSpy();

      await repository.findForUser({ organizationId: "org-1", userId: "user-1" });

      expect(excludedNames(findMany)).toEqual([...HIDDEN_SYSTEM_KEY_NAMES]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isSystemManaged: false }) }),
      );
    });
  });

  /**
   * The sweep runs cross-tenant, so every clause is load-bearing: the name
   * keeps it off customer keys, `revokedAt IS NULL` stops rewriting retired
   * rows, and `expiresAt IS NOT NULL` keeps a no-expiry key out of `<=`.
   */
  describe("when sweeping expired keys of one reserved name", () => {
    /** @scenario "The sandbox sweep revokes only elapsed sandbox keys" */
    it("stamps the elapsed, unrevoked keys of that name as of the sweep's instant", async () => {
      const { repository, sweep } = repositoryWithSweepSpy();
      const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now });

      const { text, values } = sweptSql(sweep);
      expect(text).toContain("-- @tenancy:");
      expect(text).toContain('"expiresAt" <= ?');
      expect(values).toEqual([toDate(now), "Agent sandbox run", toDate(now), false]);
    });

    /** @scenario "A key with no expiry is never swept" */
    it("requires an expiry to exist before comparing it", async () => {
      const { repository, sweep } = repositoryWithSweepSpy();

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now: nowInstant() });

      expect(sweptSql(sweep).text).toContain('"expiresAt" IS NOT NULL');
    });

    /** @scenario "The sandbox sweep leaves live and already-revoked keys alone" */
    it("never reconsiders a key it has already revoked", async () => {
      const { repository, sweep } = repositoryWithSweepSpy();

      await repository.revokeExpiredByName({ name: "Agent sandbox run", now: nowInstant() });

      expect(sweptSql(sweep).text).toContain('"revokedAt" IS NULL');
    });

    /** @scenario "The sandbox sweep reports how many keys it retired" */
    it("answers the row count Postgres reported", async () => {
      const { repository } = repositoryWithSweepSpy(3);

      await expect(
        repository.revokeExpiredByName({ name: "Agent sandbox run", now: nowInstant() }),
      ).resolves.toBe(3);
    });

    it("keeps to marked rows for a name a customer key could also carry", async () => {
      const { repository, sweep } = repositoryWithSweepSpy();

      await repository.revokeExpiredByName({ name: WORKFLOW_RUN_API_KEY_NAME, now: nowInstant() });

      const { text, values } = sweptSql(sweep);
      expect(text).toContain('("isSystemManaged" = true OR ? = false)');
      expect(values.at(-1)).toBe(true);
    });

    it("refuses a name that is not reserved, before any SQL runs", async () => {
      const { repository, sweep } = repositoryWithSweepSpy();

      await expect(
        repository.revokeExpiredByName({ name: "my production key", now: nowInstant() }),
      ).rejects.toThrow(/not a reserved name/);
      expect(sweep).not.toHaveBeenCalled();
    });
  });

  describe("when finding elapsed CLI login keys", () => {
    function repositoryWithLoginSpies() {
      const findMany = vi.fn(async (_args: unknown) => []);
      const query = vi.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => []);
      const database = prismaDouble({
        apiKey: { findMany },
        $queryRaw: (sql, ...values) => {
          if ("sql" in sql) throw new Error("the sweep reads through a tagged template");
          return query(sql, ...values);
        },
      });
      return { repository: PrismaApiKeyRepository.create({ prisma: database }), findMany, query };
    }

    it("keeps an organization's lookup inside that organization, off raw SQL", async () => {
      const { repository, findMany, query } = repositoryWithLoginSpies();

      await repository.findElapsedLoginKeys({ now: nowInstant(), organizationId: "org-1" });

      expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { organizationId: "org-1" } });
      expect(query).not.toHaveBeenCalled();
    });

    it("bounds the fleet-wide sweep to unrevoked, elapsed keys under the login prefix", async () => {
      const { repository, findMany, query } = repositoryWithLoginSpies();
      const now = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

      await repository.findElapsedLoginKeys({ now });

      const [sql, ...values] = query.mock.calls[0] ?? [];
      const text = sql?.join("?") ?? "";
      expect(text).toContain("-- @tenancy:");
      expect(text).toContain('starts_with("name", ?)');
      expect(text).toContain('"revokedAt" IS NULL');
      expect(text).toContain('"expiresAt" IS NOT NULL');
      expect(values).toEqual([CLI_LOGIN_KEY_NAME_PREFIX, toDate(now)]);
      expect(findMany).not.toHaveBeenCalled();
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
