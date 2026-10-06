/**
 * @vitest-environment node
 * Ops' ledger repository against a real Postgres, through the tenancy-guarded client. Rows are
 * seeded inside a transaction that is rolled back, so the shared ledger is left as it was.
 * Spec: modules/ops/specs/upgrades-checkup.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  type PrismaConnection,
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { LEDGER_TABLES_DDL } from "@langwatch/upgrade";
import type { UpgradeStatus, UpgradeStepPage } from "@langwatch/upgrade/reader";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaUpgradeLedgerRepository } from "../prisma.upgrade-ledger.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const TENANCY = "-- @tenancy: the test seeds the installation's upgrade ledger.\n";

class RolledBack extends Error {}

describe.skipIf(!DB_URL)("ops' upgrade ledger on Postgres", () => {
  let prisma: PrismaClient;
  const ns = randomUUID().slice(0, 8);
  const PENDING = `prisma:29990101000000_pending_${ns}`;
  const FAILED = `clickhouse:9999${ns}`;

  beforeAll(() => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:upgrade-ledger"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("given the ledger holds a pending and a failed blocking step", () => {
    /** @scenario "Ops reads the upgrade ledger in its own Postgres" */
    it("lists both steps and names the failed one in the status", async () => {
      let read: unknown;
      await expect(
        prisma.$transaction(async (tx) => {
          for (const statement of LEDGER_TABLES_DDL) {
            await tx.$executeRawUnsafe(`${TENANCY}${statement}`);
          }
          await tx.$executeRawUnsafe(
            `${TENANCY}INSERT INTO "_langwatch_upgrade_step"
               ("id", "kind", "mode", "status", "updated_at")
             VALUES ($1, 'postgres-schema', 'blocking', 'pending', now()),
                    ($2, 'clickhouse-schema', 'blocking', 'failed', now())`,
            PENDING,
            FAILED,
          );
          const ledger = PrismaUpgradeLedgerRepository.create({ prisma: tx });
          const [page, status] = await Promise.all([
            ledger.findSteps({ mode: "blocking" }),
            ledger.findStatus(),
          ]);
          read = { page, status };
          throw new RolledBack();
        }),
      ).rejects.toBeInstanceOf(RolledBack);

      const { page, status } = read as { page: UpgradeStepPage; status: UpgradeStatus };
      expect(page.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: PENDING,
            kind: "postgres-schema",
            mode: "blocking",
            status: "pending",
          }),
          expect.objectContaining({
            id: FAILED,
            kind: "clickhouse-schema",
            mode: "blocking",
            status: "failed",
          }),
        ]),
      );
      expect(status.failedStepIds).toContain(FAILED);
    });
  });
});
