/**
 * Spec: packages/features/identity/specs/identity-email-postgres-read-fork.feature
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { PostgresIdentityEmailAdapter } from "../postgres.identity-email.adapter";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../repositories/prisma/prisma.identity-latch.repository";

type Row = Record<string, unknown>;

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function identifier(overrides: Row = {}): Row {
  return {
    id: "identifier_1",
    userId: "user-1",
    provider: "email",
    value: "alex@example.test",
    domain: "example.test",
    identifierHash: null,
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    state: "PRIMARY",
    connectionId: null,
    verifiedAt: new Date(NOW),
    attachedAt: new Date(NOW),
    detachedAt: null,
    ...overrides,
  };
}

type Recorded = {
  latchAnyone: number;
  latchUser: number;
  identifiers: number;
};

/**
 * A client whose two identity delegates answer and whose every other delegate
 * refuses.
 *
 * Refusing the rest is what makes "it never reads the identifier projection"
 * an observation rather than a claim: a delegate that quietly answered would
 * let a read this fork must not make pass unnoticed.
 */
function stubClient(options: {
  anyoneFinalized?: boolean;
  statusByUser?: Record<string, string>;
  identifiers?: Row[];
  failLatch?: boolean;
}): { client: PrismaClient; calls: Recorded } {
  const calls: Recorded = { latchAnyone: 0, latchUser: 0, identifiers: 0 };
  const refuse = () => {
    throw new Error("This scenario describes only the identity delegates.");
  };
  const state = {
    findFirst: ({ where }: { where: Row }) => {
      calls.latchAnyone += 1;
      if (options.failLatch) return Promise.reject(new Error("state table unreadable"));
      expect(where.migrationName).toBe(IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME);
      expect(where.status).toBe("finalized");
      return Promise.resolve(options.anyoneFinalized ? { tenantId: "user-1" } : null);
    },
    findUnique: ({ where }: { where: { migrationName_tenantId: Row } }) => {
      calls.latchUser += 1;
      if (options.failLatch) return Promise.reject(new Error("state table unreadable"));
      const key = where.migrationName_tenantId;
      expect(key.migrationName).toBe(IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME);
      const status = options.statusByUser?.[String(key.tenantId)];
      return Promise.resolve(status === undefined ? null : { status });
    },
  };
  const identifiers = {
    findMany: ({ where }: { where: Row }) => {
      calls.identifiers += 1;
      return Promise.resolve(
        (options.identifiers ?? []).filter((row) => row.userId === where.userId),
      );
    },
  };
  const refusingDelegate = new Proxy({}, { get: () => refuse });
  const client = new Proxy(
    { systemMigrationTenantState: state, identifier: identifiers } as Record<string, unknown>,
    { get: (target, key: string) => (key in target ? target[key] : refusingDelegate) },
  );
  return { client: client as unknown as PrismaClient, calls };
}

function build(
  options: Parameters<typeof stubClient>[0] & { cacheTtlMs?: number; cacheMaxUsers?: number },
  clock: { now: number } = { now: NOW },
) {
  const { client, calls } = stubClient(options);
  const emails = PostgresIdentityEmailAdapter.create({
    database: client,
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.cacheMaxUsers === undefined ? {} : { cacheMaxUsers: options.cacheMaxUsers }),
    now: () => clock.now,
  }).build();
  return { emails, calls, clock };
}

describe("PostgresIdentityEmailAdapter", () => {
  describe("given the identifiers are allowed to answer", () => {
    /** @scenario "A finalized user's primary identifier answers for the column" */
    it("answers the primary identifier's address", async () => {
      const { emails } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "finalized" },
        identifiers: [identifier()],
      });

      await expect(emails.tryResolveEmail({ userId: "user-1" })).resolves.toBe("alex@example.test");
    });

    /** @scenario "Every proven address is offered for invitation matching" */
    it("offers every proven address and no unproven one", async () => {
      const { emails } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "finalized" },
        identifiers: [
          identifier(),
          identifier({ id: "identifier_2", value: "alex@work.test", state: "VERIFIED" }),
          identifier({ id: "identifier_3", value: "alex@new.test", state: "ATTACHED" }),
        ],
      });

      await expect(emails.tryVerifiedEmailsOf({ userId: "user-1" })).resolves.toEqual([
        { identifierId: "identifier_1", value: "alex@example.test", provider: "email" },
        { identifierId: "identifier_2", value: "alex@work.test", provider: "email" },
      ]);
    });
  });

  describe("given nobody in the deployment has finalized", () => {
    /** @scenario "A user nobody has enrolled keeps the legacy column" */
    it("keeps the legacy column without reading the projection", async () => {
      const { emails, calls } = build({ anyoneFinalized: false, identifiers: [identifier()] });

      await expect(emails.tryResolveEmail({ userId: "user-1" })).resolves.toBe(null);
      expect(calls.identifiers).toBe(0);
      expect(calls.latchUser).toBe(0);
    });
  });

  describe("given the user's backfill is held rather than finalized", () => {
    /** @scenario "A held user keeps the legacy column" */
    it("keeps the legacy column", async () => {
      const { emails, calls } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "migrated" },
        identifiers: [identifier()],
      });

      await expect(emails.tryResolveEmail({ userId: "user-1" })).resolves.toBe(null);
      expect(calls.identifiers).toBe(0);
    });
  });

  describe("given the migration-state table cannot be read", () => {
    /** @scenario "An unreadable latch keeps the legacy column and says so" */
    it("keeps the legacy column", async () => {
      const { emails } = build({ failLatch: true, identifiers: [identifier()] });

      await expect(emails.tryResolveEmail({ userId: "user-1" })).resolves.toBe(null);
    });

    /** @scenario "An unreadable latch keeps the legacy column and says so" */
    it("logs the failed read rather than swallowing it", async () => {
      // The factory hands back one logger per name for the life of the
      // process, so this is the instance the adapter module already holds.
      const warn = vi.spyOn(createLogger("langwatch:identity:latch"), "warn");
      const { emails } = build({ failLatch: true });

      await emails.tryResolveEmail({ userId: "user-1" });
      // Restored before the assertion: a spy left installed by a failing
      // expectation would leak its call history into the next test.
      const calls = [...warn.mock.calls];
      warn.mockRestore();

      expect(calls).toEqual([
        [
          expect.objectContaining({ error: expect.any(Error) }),
          expect.stringContaining("identifier backfill"),
        ],
      ]);
    });
  });

  describe("given a stored identifier this build cannot parse", () => {
    /** @scenario "A projection row this build cannot parse keeps the legacy column" */
    it("keeps the legacy column", async () => {
      const { emails } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "finalized" },
        identifiers: [identifier({ state: "SUPERSEDED_BY_A_LATER_BUILD" })],
      });

      await expect(emails.tryResolveEmail({ userId: "user-1" })).resolves.toBe(null);
    });
  });

  describe("when the latch has already been read for a user", () => {
    /** @scenario "A second resolution inside the window reads nothing further" */
    it("reads the migration-state table no further inside the window", async () => {
      const { emails, calls } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "finalized" },
        identifiers: [identifier()],
        cacheTtlMs: 60_000,
      });

      await emails.tryResolveEmail({ userId: "user-1" });
      await emails.tryResolveEmail({ userId: "user-1" });

      expect(calls.latchAnyone).toBe(1);
      expect(calls.latchUser).toBe(1);
      expect(calls.identifiers).toBe(2);
    });

    /** @scenario "The answer is re-read once the window closes" */
    it("reads it again once the window closes", async () => {
      const clock = { now: NOW };
      const { emails, calls } = build(
        {
          anyoneFinalized: true,
          statusByUser: { "user-1": "finalized" },
          identifiers: [identifier()],
          cacheTtlMs: 60_000,
        },
        clock,
      );

      await emails.tryResolveEmail({ userId: "user-1" });
      clock.now += 60_001;
      await emails.tryResolveEmail({ userId: "user-1" });

      expect(calls.latchAnyone).toBe(2);
      expect(calls.latchUser).toBe(2);
    });
  });

  describe("when two resolutions for one cold user run concurrently", () => {
    /** @scenario "Concurrent resolutions of one cold user share a single read" */
    it("reads the migration-state table once", async () => {
      const { emails, calls } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "finalized" },
        identifiers: [identifier()],
      });

      await Promise.all([
        emails.tryResolveEmail({ userId: "user-1" }),
        emails.tryResolveEmail({ userId: "user-1" }),
      ]);

      expect(calls.latchAnyone).toBe(1);
      expect(calls.latchUser).toBe(1);
    });
  });

  describe("when more users are resolved than the cache holds", () => {
    /** @scenario "The per-user cache is bounded" */
    it("stays within its cap and re-reads an evicted user", async () => {
      const { emails, calls } = build({
        anyoneFinalized: true,
        statusByUser: { "user-1": "finalized", "user-2": "finalized", "user-3": "finalized" },
        identifiers: [identifier()],
        cacheMaxUsers: 2,
      });

      await emails.tryResolveEmail({ userId: "user-1" });
      await emails.tryResolveEmail({ userId: "user-2" });
      await emails.tryResolveEmail({ userId: "user-3" });
      const beforeReRead = calls.latchUser;
      await emails.tryResolveEmail({ userId: "user-1" });

      expect(beforeReRead).toBe(3);
      expect(calls.latchUser).toBe(4);
    });
  });

  describe("given the platform application's own migration record", () => {
    /** @scenario "The latch reads the D01 backfill's stored record" */
    it("reads the record under the D01 backfill's stored name", () => {
      expect(IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME).toBe("identity-d01-identifier-backfill");
    });
  });
});
