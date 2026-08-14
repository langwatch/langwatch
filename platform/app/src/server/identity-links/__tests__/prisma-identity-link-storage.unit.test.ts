import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import { PrismaIdentityLinkStorage } from "../prisma-identity-link-storage";

const login = {
  provider: "databricks",
  providerConnectionId: "conn-1",
  externalKind: "numeric_id",
  externalId: "12345",
} as const;

const appendInput = {
  ...login,
  organizationId: "org-a",
  userId: "user-1",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  source: "manual",
  actorUserId: "admin-1",
} as const;

const makePrisma = () => {
  const prisma = {
    ingestionSource: { findFirst: vi.fn() },
    providerIdentityLink: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(
      async (fn: (tx: unknown) => Promise<unknown>) => await fn(prisma),
    ),
  };
  return prisma;
};

describe("PrismaIdentityLinkStorage — organization isolation (ADR-094 Invariants)", () => {
  it("rejects a providerConnectionId owned by another organization, before any insert", async () => {
    const prisma = makePrisma();
    prisma.ingestionSource.findFirst.mockResolvedValue(null);
    const storage = new PrismaIdentityLinkStorage(
      prisma as unknown as PrismaClient,
    );

    await expect(storage.appendLink(appendInput)).rejects.toThrow(
      /does not belong to organization/,
    );
    expect(prisma.providerIdentityLink.create).not.toHaveBeenCalled();
    expect(prisma.ingestionSource.findFirst).toHaveBeenCalledWith({
      where: { id: "conn-1", organizationId: "org-a" },
      select: { id: true },
    });
  });

  it("appends when the connection belongs to the organization", async () => {
    const prisma = makePrisma();
    prisma.ingestionSource.findFirst.mockResolvedValue({ id: "conn-1" });
    prisma.providerIdentityLink.create.mockResolvedValue({
      id: "link-1",
      seq: 1n,
      recordedAt: new Date("2026-01-02T00:00:00Z"),
      erasedAt: null,
      ...appendInput,
    });
    const storage = new PrismaIdentityLinkStorage(
      prisma as unknown as PrismaClient,
    );

    const row = await storage.appendLink(appendInput);
    expect(row.userId).toBe("user-1");
    const createArg = prisma.providerIdentityLink.create.mock.calls[0]![0];
    expect(createArg.data.organizationId).toBe("org-a");
    // Add-only: no id, seq or recordedAt supplied — the database assigns them.
    expect(createArg.data.id).toBeUndefined();
    expect(createArg.data.seq).toBeUndefined();
  });

  it("scopes every read by organizationId and never crosses connections", async () => {
    const prisma = makePrisma();
    prisma.providerIdentityLink.findMany.mockResolvedValue([]);
    const storage = new PrismaIdentityLinkStorage(
      prisma as unknown as PrismaClient,
    );

    await storage.listLinksForLogins("org-a", [login]);
    const where = prisma.providerIdentityLink.findMany.mock.calls[0]![0].where;
    expect(where.organizationId).toBe("org-a");
    expect(where.OR[0]).toEqual(login);

    // No query at all for an empty login list.
    prisma.providerIdentityLink.findMany.mockClear();
    await storage.listLinksForLogins("org-a", []);
    expect(prisma.providerIdentityLink.findMany).not.toHaveBeenCalled();
  });
});

describe("PrismaIdentityLinkStorage — add-only mutator surface (ADR-094 Invariants)", () => {
  it("exposes exactly appendLink and eraseIdentifiers as mutators — no update, no delete", () => {
    const methods = Object.getOwnPropertyNames(
      PrismaIdentityLinkStorage.prototype,
    )
      .filter((name) => name !== "constructor")
      .sort();
    expect(methods).toEqual([
      "appendLink",
      "eraseIdentifiers",
      "listLinksForLogins",
    ]);
  });
});

describe("PrismaIdentityLinkStorage — erasure blanks who, never which rows (ADR-094 Decision 9)", () => {
  it("blanks userId and actorUserId, swaps email-kind ids, stamps erasedAt, deletes nothing", async () => {
    const prisma = makePrisma();
    const erasedAt = new Date("2026-06-01T00:00:00Z");
    prisma.providerIdentityLink.findMany.mockResolvedValue([
      // The person's own link row, non-email kind: only userId blanks.
      {
        id: "row-own",
        userId: "user-1",
        actorUserId: "admin-1",
        externalKind: "numeric_id",
        externalId: "12345",
      },
      // A row the person AUTHORED for someone else: only actorUserId blanks.
      {
        id: "row-authored",
        userId: "someone-else",
        actorUserId: "user-1",
        externalKind: "numeric_id",
        externalId: "99999",
      },
      // An email-kind row: the value swaps for the caller-derived token.
      {
        id: "row-email",
        userId: "user-1",
        actorUserId: null,
        externalKind: "email",
        externalId: "alice@example.com",
      },
    ]);
    const storage = new PrismaIdentityLinkStorage(
      prisma as unknown as PrismaClient,
    );

    const result = await storage.eraseIdentifiers({
      organizationId: "org-a",
      userId: "user-1",
      emailTokenByExternalId: new Map([["alice@example.com", "tok_opaque"]]),
      erasedAt,
    });

    expect(result.linkRowsTouched).toBe(3);
    const updates = prisma.providerIdentityLink.update.mock.calls.map(
      (call) => call[0],
    );
    expect(updates).toEqual([
      {
        where: { id: "row-own" },
        data: {
          userId: null,
          actorUserId: "admin-1",
          externalId: "12345",
          erasedAt,
        },
      },
      {
        where: { id: "row-authored" },
        data: {
          userId: "someone-else",
          actorUserId: null,
          externalId: "99999",
          erasedAt,
        },
      },
      {
        where: { id: "row-email" },
        data: {
          userId: null,
          actorUserId: null,
          externalId: "tok_opaque",
          erasedAt,
        },
      },
    ]);
  });

  it("matches email values only under email kinds — a colliding value in another kind is untouched", async () => {
    const prisma = makePrisma();
    prisma.providerIdentityLink.findMany.mockResolvedValue([]);
    const storage = new PrismaIdentityLinkStorage(
      prisma as unknown as PrismaClient,
    );

    await storage.eraseIdentifiers({
      organizationId: "org-a",
      userId: "user-1",
      emailTokenByExternalId: new Map([["alice@example.com", "tok_opaque"]]),
      erasedAt: new Date("2026-06-01T00:00:00Z"),
    });

    const where = prisma.providerIdentityLink.findMany.mock.calls[0]![0].where;
    expect(where.organizationId).toBe("org-a");
    expect(where.OR[2]).toEqual({
      externalKind: { in: ["email"] },
      externalId: { in: ["alice@example.com"] },
    });
  });
});
