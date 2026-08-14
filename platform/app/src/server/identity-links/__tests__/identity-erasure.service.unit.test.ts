// @vitest-environment node
// ADR-094 Decision 9 + Gates ("human review, always + count-first dry run
// printed before execution"). The invariant under test is that erasure removes
// WHO somebody was and never WHICH rows exist.
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  createFakePrisma,
  type FakePrisma,
} from "~/server/users/__tests__/fake-prisma";

import { IdentityErasureTokenService } from "../erasure-token.service";
import { IdentityErasureService } from "../identity-erasure.service";
import { ERASED_SNAPSHOT_VALUE } from "../snapshot-erasure";

const SECRET = "e".repeat(64);
const ERASED_AT = new Date("2026-06-01T00:00:00Z");

const link = (overrides: Record<string, unknown>) => ({
  id: `link-${Math.random()}`,
  seq: 1n,
  organizationId: "org-a",
  provider: "anthropic",
  providerConnectionId: "conn-a",
  externalKind: "member_id",
  externalId: "mem-1",
  userId: "alice",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  recordedAt: new Date("2026-01-01T00:00:00Z"),
  source: "manual",
  actorUserId: null,
  erasedAt: null,
  ...overrides,
});

/**
 * Alice is both a subject and an actor: she holds links of her own AND once
 * linked somebody else as an admin. That combination is what the Invariants
 * table names — an erasure that only blanked `userId` would leave her name
 * sitting in `actorUserId` on a colleague's row.
 */
const seedAlice = () =>
  createFakePrisma({
    users: [{ id: "alice", email: "Alice@Example.com", deactivatedAt: null }],
    organizationUsers: [
      {
        userId: "alice",
        organizationId: "org-a",
        disabledAt: null,
        externalId: "entra-obj-123",
        scimSource: "azure-ad",
      },
    ],
    ingestionSources: [{ id: "conn-a", organizationId: "org-a" }],
    providerIdentityLinks: [
      link({ id: "own-typed", externalKind: "member_id", externalId: "mem-1" }),
      link({
        id: "own-email",
        externalKind: "email",
        externalId: "alice@example.com",
      }),
      link({
        id: "authored-for-bob",
        userId: "bob",
        actorUserId: "alice",
        externalId: "mem-2",
      }),
      // Somebody else's row entirely — the blast radius must stop here.
      link({ id: "bobs-own", userId: "bob", externalId: "mem-3" }),
    ],
    discoveredAgents: [
      {
        id: "agent-1",
        organizationId: "org-a",
        providerConnectionId: "conn-a",
        providerAgentKey: "env-1/bot-1",
        snapshot: { displayName: "Helper", ownerEmail: "alice@example.com" },
        erasedAt: null,
      },
      {
        id: "agent-2",
        organizationId: "org-a",
        providerConnectionId: "conn-a",
        providerAgentKey: "env-1/bot-2",
        snapshot: { displayName: "Untouched", ownerEmail: "bob@example.com" },
        erasedAt: null,
      },
    ],
  });

const serviceFor = (prisma: FakePrisma) =>
  new IdentityErasureService(
    prisma as unknown as PrismaClient,
    new IdentityErasureTokenService(SECRET),
    () => ERASED_AT,
  );

const rowsOf = (
  prisma: FakePrisma,
  table: "providerIdentityLink" | "discoveredAgent",
) =>
  Object.fromEntries(
    prisma[table].rows.map((row) => [String(row.id), row]),
  ) as Record<string, Record<string, unknown>>;

/** Rows carry a BigInt `seq`, which `JSON.stringify` refuses outright. */
const snapshotOf = (rows: readonly Record<string, unknown>[]) =>
  JSON.stringify(rows, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );

describe("IdentityErasureService", () => {
  describe("given a dry run", () => {
    it("counts every category and writes nothing", async () => {
      const prisma = seedAlice();
      const before = snapshotOf(prisma.providerIdentityLink.rows);

      const preview = await serviceFor(prisma).preview({
        organizationId: "org-a",
        userId: "alice",
      });

      // Three link rows name her: two of her own plus the one she authored.
      expect(preview).toEqual({
        organizationId: "org-a",
        userId: "alice",
        linkRows: 3,
        directoryAnchors: 1,
        agentSnapshots: 1,
        emailLoginsTokenized: 1,
      });
      expect(snapshotOf(prisma.providerIdentityLink.rows)).toBe(before);
      expect(prisma.discoveredAgent.rows[0]!.erasedAt).toBeNull();
      expect(prisma.organizationUser.rows[0]!.externalId).toBe("entra-obj-123");
    });
  });

  describe("given no confirmation", () => {
    it("refuses rather than destroying identifiers on the first attempt", async () => {
      const prisma = seedAlice();
      await expect(
        serviceFor(prisma).erase({
          organizationId: "org-a",
          userId: "alice",
          confirm: false,
        }),
      ).rejects.toThrow(/explicit confirmation/);
      expect(prisma.organizationUser.rows[0]!.externalId).toBe("entra-obj-123");
    });
  });

  describe("given a confirmed erasure of somebody who was also an admin actor", () => {
    it("blanks userId, actorUserId, the anchor and the snapshot, and stamps erasedAt", async () => {
      const prisma = seedAlice();

      const result = await serviceFor(prisma).erase({
        organizationId: "org-a",
        userId: "alice",
        confirm: true,
      });

      expect(result).toEqual({
        organizationId: "org-a",
        userId: "alice",
        erasedAt: ERASED_AT,
        linkRows: 3,
        directoryAnchors: 1,
        agentSnapshots: 1,
      });

      const links = rowsOf(prisma, "providerIdentityLink");
      expect(links["own-typed"]!.userId).toBeNull();
      expect(links["own-typed"]!.erasedAt).toBe(ERASED_AT);
      // The non-email login id survives — after `userId` and the anchor are
      // gone it is a pseudonym whose key we no longer hold (Decision 9).
      expect(links["own-typed"]!.externalId).toBe("mem-1");

      // She authored this one; only her name as the actor goes.
      expect(links["authored-for-bob"]!.userId).toBe("bob");
      expect(links["authored-for-bob"]!.actorUserId).toBeNull();
      expect(links["authored-for-bob"]!.erasedAt).toBe(ERASED_AT);

      // Somebody else's row is untouched, including its erasure marker.
      expect(links["bobs-own"]!.userId).toBe("bob");
      expect(links["bobs-own"]!.erasedAt).toBeNull();

      const anchor = prisma.organizationUser.rows[0]!;
      expect(anchor.externalId).toBeNull();
      expect(anchor.scimSource).toBeNull();

      const agents = rowsOf(prisma, "discoveredAgent");
      expect(agents["agent-1"]!.snapshot).toEqual({
        displayName: "Helper",
        ownerEmail: ERASED_SNAPSHOT_VALUE,
      });
      expect(agents["agent-1"]!.erasedAt).toBe(ERASED_AT);
      // An agent naming nobody is neither rewritten nor stamped.
      expect(agents["agent-2"]!.erasedAt).toBeNull();
    });

    it("swaps the email login for the token the report will re-derive", async () => {
      const prisma = seedAlice();
      await serviceFor(prisma).erase({
        organizationId: "org-a",
        userId: "alice",
        confirm: true,
      });

      const stored = rowsOf(prisma, "providerIdentityLink")["own-email"]!
        .externalId as string;
      const reportDerived = new IdentityErasureTokenService(SECRET).tokenFor({
        organizationId: "org-a",
        // What ClickHouse still holds — the provider's own casing.
        email: "Alice@Example.com",
      });
      expect(stored).toBe(reportDerived);
      expect(stored).not.toContain("@");
    });

    it("keeps every row in place — erasure never shortens a timeline", async () => {
      const prisma = seedAlice();
      const idsBefore = prisma.providerIdentityLink.rows.map((row) => row.id);

      await serviceFor(prisma).erase({
        organizationId: "org-a",
        userId: "alice",
        confirm: true,
      });

      expect(prisma.providerIdentityLink.rows.map((row) => row.id)).toEqual(
        idsBefore,
      );
    });
  });

  describe("erasure versus unlink", () => {
    // Both leave `userId` null. `erasedAt` is the only thing that keeps
    // "person forgotten" distinguishable from "admin closed the link" forever.
    it("is told apart by erasedAt, not by userId", async () => {
      const prisma = seedAlice();
      prisma.providerIdentityLink.rows.push(
        link({ id: "unlinked", userId: null, externalId: "mem-9" }),
      );

      await serviceFor(prisma).erase({
        organizationId: "org-a",
        userId: "alice",
        confirm: true,
      });

      const links = rowsOf(prisma, "providerIdentityLink");
      expect(links.unlinked!.userId).toBeNull();
      expect(links.unlinked!.erasedAt).toBeNull();
      expect(links["own-typed"]!.userId).toBeNull();
      expect(links["own-typed"]!.erasedAt).toBe(ERASED_AT);
    });
  });
});
