/**
 * @vitest-environment node
 *
 * The runner's guarded state write against a real Postgres, interleaved with
 * an operator's pin on the same row.
 *
 * The guard reads `status <> 'rolled_back'` on the write itself, and the
 * docblock promises an operator's pin can never be overwritten. That only
 * holds when the write that waited on the pin's row lock re-checks the guard
 * against the row as the pin left it, which is what this stages: the pin is
 * held open in its own transaction until the runner's write is parked, and
 * only then commits.
 *
 * @see ../system-migration-state.prisma.repository.ts
 * @see specs/migration/system-migrations-runner.feature
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { raceOnOneRow } from "~/test-utils/rowLockInterleaving";
import { PrismaSystemMigrationStateRepository } from "../system-migration-state.prisma.repository";

const ns = `migstate-${nanoid(8)}`;
const MIGRATION = `state-race-${ns}`;
const TENANT = `${ns}-tenant`;

afterAll(async () => {
  await prisma.systemMigrationTenantState.deleteMany({
    where: { migrationName: MIGRATION, tenantId: TENANT },
  });
});

describe("the per-tenant migration state on Postgres", () => {
  describe("given a tenant the runner has migrated", () => {
    describe("when an operator pins it rolled back as the runner's pass writes", () => {
      /** @scenario "An operator's pin written during a pass stands" */
      it("keeps the pin, because the runner's write re-reads the row it waited for", async () => {
        await new PrismaSystemMigrationStateRepository(prisma).upsertRecord({
          migrationName: MIGRATION,
          tenantId: TENANT,
          status: "migrated",
          report: null,
        });

        const answers = await raceOnOneRow<boolean>({
          prisma,
          table: "SystemMigrationTenantState",
          first: async (tx) => {
            await new PrismaSystemMigrationStateRepository(tx).upsertRecord({
              migrationName: MIGRATION,
              tenantId: TENANT,
              status: "rolled_back",
              report: { reason: "operator pin" },
            });
            return true;
          },
          // On the root client: a guarded write that matches nothing falls
          // back to a create, and the unique collision that answers it would
          // abort a transaction of its own.
          second: () =>
            new PrismaSystemMigrationStateRepository(
              prisma,
            ).upsertRecordUnlessRolledBack({
              migrationName: MIGRATION,
              tenantId: TENANT,
              status: "finalized",
              report: null,
            }),
        });

        expect(answers.second).toBe(false);
        const row = await prisma.systemMigrationTenantState.findUniqueOrThrow({
          where: {
            migrationName_tenantId: {
              migrationName: MIGRATION,
              tenantId: TENANT,
            },
          },
        });
        expect(row.status).toBe("rolled_back");
        expect(row.report).toEqual({ reason: "operator pin" });
      });
    });
  });
});
