/**
 * @vitest-environment node
 * The runner's guarded write against a real Postgres, interleaved with an
 * operator's pin on the same row.
 * @see specs/migration/system-migrations-runner.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { raceOnOneRow } from "../../../__tests__/support/row-lock-race.ts";
import { PrismaSystemMigrationStateRepository } from "../prisma.system-migration-state.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("the per-tenant migration state on Postgres", () => {
  let prisma: PrismaClient;
  const ns = `migstate-${randomUUID().slice(0, 8)}`;
  const MIGRATION = `state-race-${ns}`;
  const TENANT = `${ns}-tenant`;

  beforeAll(() => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:system-migration-state"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
  });

  afterAll(async () => {
    await prisma.systemMigrationTenantState.deleteMany({
      where: { migrationName: MIGRATION, tenantId: TENANT },
    });
    await prisma.$disconnect();
  });

  describe("given a tenant the runner has migrated", () => {
    describe("when an operator pins it rolled back as the runner's pass writes", () => {
      /** @scenario "An operator's pin written during a pass stands" */
      it("keeps the pin, because the runner's write re-reads the row it waited for", async () => {
        const repository = PrismaSystemMigrationStateRepository.create({ prisma });
        await repository.upsertRecord({
          migrationName: MIGRATION,
          tenantId: TENANT,
          status: "migrated",
          report: null,
        });

        const answers = await raceOnOneRow<boolean>({
          prisma,
          table: "SystemMigrationTenantState",
          first: async (tx) => {
            await tx.systemMigrationTenantState.update({
              where: { migrationName_tenantId: { migrationName: MIGRATION, tenantId: TENANT } },
              data: { status: "rolled_back", report: { reason: "operator pin" } },
            });
            return true;
          },
          // On the root client: the guarded write that matches nothing falls back
          // to a create, and the collision answering it would abort a transaction.
          second: () =>
            repository.upsertRecordUnlessRolledBack({
              migrationName: MIGRATION,
              tenantId: TENANT,
              status: "finalized",
              report: null,
            }),
        });

        expect(answers.second).toBe(false);
        const row = await prisma.systemMigrationTenantState.findUniqueOrThrow({
          where: { migrationName_tenantId: { migrationName: MIGRATION, tenantId: TENANT } },
        });
        expect(row.status).toBe("rolled_back");
        expect(row.report).toEqual({ reason: "operator pin" });
      });
    });
  });
});
