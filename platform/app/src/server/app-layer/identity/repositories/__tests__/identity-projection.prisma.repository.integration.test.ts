import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { createTenantId } from "~/server/event-sourcing";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { PrismaIdentityProjectionRepository } from "../identity-projection.prisma.repository";

/**
 * The fold's store against real Postgres: rows are upserted whole
 * (ADR-101 §3, replay's writes win), the cursor is the commit marker written
 * LAST, and a store that never ran leaves `load` answering null so the fold
 * starts from init rather than a half-written head.
 */
const namespace = `idproj-${nanoid(8)}`;
const USER = `${namespace}-user`;
const repository = new PrismaIdentityProjectionRepository(prisma);
const context = { aggregateId: USER, tenantId: createTenantId(USER) };

function projection(
  identifiers: IdentityFoldState["identifiers"],
  cursor: { acceptedAt: number; eventId: string },
): StoredProjection<IdentityFoldState> {
  return {
    state: {
      userId: USER,
      identifiers,
      CreatedAt: 1,
      UpdatedAt: 2,
      LastEventOccurredAt: 3,
    },
    cursor,
    occurredAt: 1_690_000_000_000,
    createdAt: 1_690_000_000_000,
    updatedAt: 1_690_000_000_000,
    version: "2026-08-20",
  };
}

const fact = (id: string, state: "ATTACHED" | "VERIFIED" | "DETACHED") => ({
  identifierId: id,
  userId: USER,
  provider: "email" as const,
  value: `${namespace}@acme.com`,
  domain: "acme.com",
  identifierHash: "hmac:abc",
  accountId: null,
  providerAccountId: null,
  connectionId: null,
  state,
  verifiedAtMs: state === "ATTACHED" ? null : 1_690_000_001_000,
  attachedAtMs: 1_690_000_000_000,
  detachedAtMs: state === "DETACHED" ? 1_690_000_002_000 : null,
});

afterEach(async () => {
  await prisma.identifier.deleteMany({ where: { userId: USER } });
  await prisma.identityProjectionCursor.deleteMany({ where: { userId: USER } });
});

describe("PrismaIdentityProjectionRepository", () => {
  describe("when no fold has ever stored the user", () => {
    it("loads null, so the fold starts from init", async () => {
      expect(await repository.load(USER, context)).toBeNull();
    });
  });

  describe("when a fold stores heads and a cursor", () => {
    it("round-trips rows and cursor, and a later store upserts whole-row", async () => {
      const id = `${namespace}-idf`;
      await repository.store(
        projection(
          { [id]: fact(id, "ATTACHED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );

      const first = await repository.load(USER, context);
      expect(first?.cursor).toEqual({ acceptedAt: 10, eventId: "evt_1" });
      expect(first?.state.identifiers[id]).toMatchObject({
        state: "ATTACHED",
        verifiedAtMs: null,
      });

      await repository.store(
        projection(
          { [id]: fact(id, "VERIFIED") },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      const second = await repository.load(USER, context);
      expect(second?.cursor).toEqual({ acceptedAt: 20, eventId: "evt_2" });
      expect(second?.state.identifiers[id]).toMatchObject({
        state: "VERIFIED",
        verifiedAtMs: 1_690_000_001_000,
      });
      expect(await prisma.identifier.count({ where: { userId: USER } })).toBe(
        1,
      );
    });

    it("keeps a detached row as a tombstone rather than deleting it", async () => {
      const id = `${namespace}-tomb`;
      await repository.store(
        projection(
          { [id]: fact(id, "VERIFIED") },
          { acceptedAt: 10, eventId: "evt_1" },
        ),
        context,
      );
      await repository.store(
        projection(
          { [id]: fact(id, "DETACHED") },
          { acceptedAt: 20, eventId: "evt_2" },
        ),
        context,
      );

      const row = await prisma.identifier.findUnique({ where: { id } });
      expect(row?.state).toBe("DETACHED");
      expect(row?.detachedAt?.getTime()).toBe(1_690_000_002_000);
      expect(row?.value).toBe(`${namespace}@acme.com`);
    });
  });
});
