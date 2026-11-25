// Spec: modules/identity/specs/sign-in-switch.feature
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaIdentityLatchRepository } from "../repositories/prisma/prisma.identity-latch.repository.ts";
import { PrismaIdentityMigrationRepository } from "../repositories/prisma/prisma.identity-migration.repository.ts";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../rules/identity-migration-names.rules.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const FINALIZED_AT = new Date("2026-08-18T09:00:00.000Z");

describe.skipIf(!DB_URL)("identity's sign-in switch over Postgres", () => {
  const namespace = `switch-${nanoid(8)}`;
  const ids = {
    signUp: `${namespace}-sign-up`,
    pinned: `${namespace}-pinned`,
    carried: `${namespace}-carried`,
  };
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:sign-in-switch"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const latch = PrismaIdentityLatchRepository.create(prisma);
  const migration = PrismaIdentityMigrationRepository.create(prisma);

  async function stateRow({ userId, status }: { userId: string; status: string }) {
    await prisma.systemMigrationTenantState.create({
      data: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId: userId,
        status,
        report: Prisma.DbNull,
        occurredAt: FINALIZED_AT,
      },
    });
  }

  async function switchOf(userId: string) {
    const [row] = await prisma.$queryRaw<{ onIdentifiers: boolean; switchedAt: Date }[]>`
      ${skipTenantCheck({
        // The test reads the one user's switch row it wrote.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT "onIdentifiers", "switchedAt" FROM "IdentitySignInSwitch" WHERE "userId" = ${userId}
    `;
    return row ?? null;
  }

  afterAll(async () => {
    const userIds = Object.values(ids);
    await prisma.$executeRaw`
      ${skipTenantCheck({
        // Removes only the rows this test wrote, keyed by its own user ids.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "IdentitySignInSwitch" WHERE "userId" IN (${Prisma.join(userIds)})
    `;
    await prisma.$executeRaw`
      ${skipTenantCheck({
        // Removes only the rows this test wrote, keyed by its own user ids.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "SystemMigrationTenantState"
       WHERE "migrationName" = ${IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME}
         AND "tenantId" IN (${Prisma.join(userIds)})
    `;
    await prisma.$disconnect();
  });

  /** @scenario "Sign-up sets identity's sign-in switch" */
  it("turns the switch on beside a finalized state row at the same time", async () => {
    await latch.recordFinalized({ userId: ids.signUp, report: null });

    const own = await switchOf(ids.signUp);
    const state = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: ids.signUp,
        },
      },
      select: { status: true, occurredAt: true },
    });
    expect(own?.onIdentifiers).toBe(true);
    expect(state?.status).toBe("finalized");
    expect(state?.occurredAt.getTime()).toBe(own?.switchedAt.getTime());
    await expect(latch.isFinalized({ userId: ids.signUp })).resolves.toBe(true);
  });

  /** @scenario "A user an operator rolled back stays on the legacy path at sign-up" */
  it("leaves a rolled-back user on the legacy path and the switch off", async () => {
    await stateRow({ userId: ids.pinned, status: "rolled_back" });

    await latch.recordFinalized({ userId: ids.pinned, report: null });

    await expect(switchOf(ids.pinned)).resolves.toBeNull();
    await expect(latch.isFinalized({ userId: ids.pinned })).resolves.toBe(false);
  });

  /** @scenario "A finalized user stays on the identifier path once the switch is carried over" */
  it("carries a finalized user over without moving their path", async () => {
    await stateRow({ userId: ids.carried, status: "finalized" });
    await expect(latch.isFinalized({ userId: ids.carried })).resolves.toBe(true);

    expect(await migration.carryOverSignInSwitch({ dryRun: true })).toBeGreaterThan(0);
    await migration.carryOverSignInSwitch({ dryRun: false });

    const own = await switchOf(ids.carried);
    expect(own?.onIdentifiers).toBe(true);
    expect(own?.switchedAt.getTime()).toBe(FINALIZED_AT.getTime());
    await expect(latch.isFinalized({ userId: ids.carried })).resolves.toBe(true);
  });
});
