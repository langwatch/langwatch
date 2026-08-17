import { emptyGrantsLedgerState } from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTenantId } from "~/server/event-sourcing";
import type { AuthzGrantsFoldState } from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsState.foldProjection";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { PrismaAuthzGrantsProjectionRepository } from "../authz-grants-projection.prisma.repository";

function makePrisma() {
  return {
    grant: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    roleBinding: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  } as unknown as PrismaClient;
}

const ORG = "org_1";

/**
 * Prisma stubbed down to the calls `store()` makes. Every write is a spy, so
 * a test can assert the SHAPE of the guard rather than a row count from a
 * database this suite deliberately does not have.
 */
function makeStorePrisma({
  migrationUpdateCount,
}: {
  migrationUpdateCount: number;
}) {
  const noRows = { findMany: vi.fn(async () => []) };
  return {
    grant: { ...noRows, deleteMany: vi.fn(), upsert: vi.fn() },
    role: { ...noRows, deleteMany: vi.fn(), upsert: vi.fn() },
    roleBinding: { deleteMany: vi.fn(), upsert: vi.fn() },
    customRole: { deleteMany: vi.fn(), upsert: vi.fn() },
    authzCutoverProjection: { upsert: vi.fn() },
    authzProjectionCursor: { upsert: vi.fn() },
    systemMigrationTenantState: {
      updateMany: vi.fn(async () => ({ count: migrationUpdateCount })),
      createMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as PrismaClient;
}

function storedProjection(
  migrationStates: Record<
    string,
    {
      status: "migrated" | "finalized" | "parked" | "rolled_back";
      occurredAtMs: number;
    }
  >,
): StoredProjection<AuthzGrantsFoldState> {
  return {
    state: {
      ...emptyGrantsLedgerState({ organizationId: ORG }),
      migrationStates,
      // The fold state is the reducer's state plus the base class's three
      // bookkeeping stamps; `store()` is typed against that, not the bare
      // reducer state.
      CreatedAt: 1_700_000_000_000,
      UpdatedAt: 1_700_000_000_000,
      LastEventOccurredAt: 1_700_000_000_000,
    },
    cursor: { acceptedAt: 1_700_000_000_000, eventId: "evt_1" },
    occurredAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    version: "2026-08-17",
  };
}

const CONTEXT = { aggregateId: ORG, tenantId: createTenantId(ORG) };

describe("PrismaAuthzGrantsProjectionRepository", () => {
  describe("when a revocation is enforced on the calling path", () => {
    it("deletes both heads keyed by organization and the named grant ids only", async () => {
      const prisma = makePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: ORG,
        grantIds: ["grant_a", "grant_b"],
      });

      const scoped = {
        where: { organizationId: ORG, id: { in: ["grant_a", "grant_b"] } },
      };
      expect(prisma.grant.deleteMany).toHaveBeenCalledWith(scoped);
      // Compat rows share the grant id, so a legacy-authored binding can
      // never be collateral - its id is not a grant id.
      expect(prisma.roleBinding.deleteMany).toHaveBeenCalledWith(scoped);
    });
  });

  describe("when the revocation names no grants", () => {
    it("touches nothing", async () => {
      const prisma = makePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: ORG,
        grantIds: [],
      });

      expect(prisma.grant.deleteMany).not.toHaveBeenCalled();
      expect(prisma.roleBinding.deleteMany).not.toHaveBeenCalled();
    });
  });

  /**
   * The state table is written BOTH synchronously by the runner (its
   * finalized latch must never wait on a queue) and by this fold. The guard
   * below is the only thing stopping a lagging fold from regressing a newer
   * direct write, so its shape is worth pinning.
   */
  describe("given a folded migration transition", () => {
    describe("when the row is at least as old as the transition", () => {
      it("updates it under a guard bounded by the transition's own time", async () => {
        const prisma = makeStorePrisma({ migrationUpdateCount: 1 });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({
            "authz-team-user-backfill": {
              status: "finalized",
              occurredAtMs: 1_700_000_500_000,
            },
          }),
          CONTEXT,
        );

        expect(
          prisma.systemMigrationTenantState.updateMany,
        ).toHaveBeenCalledWith({
          where: {
            migrationName: "authz-team-user-backfill",
            tenantId: ORG,
            updatedAt: { lte: new Date(1_700_000_500_000) },
          },
          data: { status: "finalized", report: expect.anything() },
        });
        // The guard matched, so nothing is created behind it.
        expect(
          prisma.systemMigrationTenantState.createMany,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when the guard matches nothing", () => {
      it("creates the row race-safely rather than forcing the write through", async () => {
        // Zero affected rows means one of two things: a NEWER direct write
        // holds the row (leave it - the guard did its job), or the row does
        // not exist yet (replay onto an empty table). Only the second is
        // actionable, and `skipDuplicates` is what keeps the first safe.
        const prisma = makeStorePrisma({ migrationUpdateCount: 0 });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({
            "authz-team-user-backfill": {
              status: "parked",
              occurredAtMs: 1_700_000_100_000,
            },
          }),
          CONTEXT,
        );

        expect(
          prisma.systemMigrationTenantState.createMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({ skipDuplicates: true }),
        );
      });
    });

    describe("when there are no transitions to write", () => {
      it("leaves the state table alone", async () => {
        const prisma = makeStorePrisma({ migrationUpdateCount: 0 });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection({}), CONTEXT);

        expect(
          prisma.systemMigrationTenantState.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prisma.systemMigrationTenantState.createMany,
        ).not.toHaveBeenCalled();
      });
    });
  });
});
