// @vitest-environment node
// ADR-094 Decision 4: the sweep is the self-healing backstop for a closing row
// that never got written. Running it twice must not append a second one.
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import { runOrphanLinkSweep } from "../orphan-link-sweep";
import { createFakePrisma, type FakePrisma } from "./fake-prisma";

const JANUARY = new Date("2026-01-01T00:00:00Z");
const SWEPT_AT = new Date("2026-06-01T00:00:00Z");

const openLink = (overrides: Record<string, unknown> = {}) => ({
  id: "link-1",
  seq: 1n,
  organizationId: "org-a",
  provider: "databricks",
  providerConnectionId: "conn-a",
  externalKind: "numeric_id",
  externalId: "1001",
  userId: "alice",
  effectiveFrom: JANUARY,
  recordedAt: JANUARY,
  source: "manual",
  actorUserId: "admin-1",
  erasedAt: null,
  ...overrides,
});

const closingRows = (prisma: FakePrisma) =>
  prisma.providerIdentityLink.rows.filter(
    (row) => row.source === "offboarding",
  );

const sweep = (prisma: FakePrisma) =>
  runOrphanLinkSweep({
    prisma: prisma as unknown as PrismaClient,
    now: () => SWEPT_AT,
  });

describe("runOrphanLinkSweep", () => {
  describe("given a link left open by a person with no active membership", () => {
    const seed = () =>
      createFakePrisma({
        organizationUsers: [
          // The membership row survives, disabled — the shape a directory
          // offboarding leaves behind.
          { userId: "alice", organizationId: "org-a", disabledAt: JANUARY },
        ],
        ingestionSources: [{ id: "conn-a", organizationId: "org-a" }],
        providerIdentityLinks: [openLink()],
      });

    it("appends the closing row that offboarding should have written", async () => {
      const prisma = seed();

      const result = await sweep(prisma);

      expect(result).toEqual({ candidates: 1, closed: 1 });
      expect(closingRows(prisma)).toHaveLength(1);
      expect(closingRows(prisma)[0]).toMatchObject({
        organizationId: "org-a",
        externalId: "1001",
        userId: null,
        source: "offboarding",
        // No session behind a sweep, so no admin is named.
        actorUserId: null,
        effectiveFrom: SWEPT_AT,
      });
    });

    it("appends nothing on the second pass", async () => {
      const prisma = seed();
      await sweep(prisma);

      const second = await sweep(prisma);

      expect(second.closed).toBe(0);
      expect(closingRows(prisma)).toHaveLength(1);
    });
  });

  describe("given the person is still an active member", () => {
    it("leaves their links alone", async () => {
      const prisma = createFakePrisma({
        organizationUsers: [
          { userId: "alice", organizationId: "org-a", disabledAt: null },
        ],
        ingestionSources: [{ id: "conn-a", organizationId: "org-a" }],
        providerIdentityLinks: [openLink()],
      });

      const result = await sweep(prisma);

      expect(result).toEqual({ candidates: 0, closed: 0 });
      expect(closingRows(prisma)).toHaveLength(0);
    });
  });

  describe("given the membership row was deleted outright", () => {
    it("still closes the links — a removed member is an ended member", async () => {
      const prisma = createFakePrisma({
        organizationUsers: [],
        ingestionSources: [{ id: "conn-a", organizationId: "org-a" }],
        providerIdentityLinks: [openLink()],
      });

      expect((await sweep(prisma)).closed).toBe(1);
    });
  });
});
