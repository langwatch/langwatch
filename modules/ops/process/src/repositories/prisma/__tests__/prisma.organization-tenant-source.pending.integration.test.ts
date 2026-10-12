/**
 * @vitest-environment node
 * Who a migration pass visits at all, asked of a real Postgres: the narrowed
 * walk is a counted subquery over the declared steps' state table.
 * @see specs/migration/system-migrations-runner.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ledgerTables, ledgerTablesDdl, type UpgradePostgres } from "@langwatch/upgrade";
import { TenantStepStateRepository } from "@langwatch/upgrade/step/tenant-state";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationTenantSourceRepository } from "../prisma.organization-tenant-source.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
// The fixture's own writes to the step state table, which describes the installation.
const LEDGER_TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

describe.skipIf(!DB_URL)("the walk a migration pass drives, on Postgres", () => {
  let prisma: PrismaClient;
  const ns = `pending-${randomUUID().slice(0, 8)}`;
  const DRIVEN = [`${ns}-first`, `${ns}-second`];
  const ORGANIZATION = `${ns}-org_acme`;

  const visited = async () => {
    const walk = PrismaOrganizationTenantSourceRepository.create({ prisma }).pendingFor({
      migrationNames: DRIVEN,
    });
    const ids = await walk.findTenantIdsAfter({ cursor: null, limit: 10_000 });
    return ids.filter((id) => id === ORGANIZATION);
  };

  let ledger: UpgradePostgres;
  const record = (migrationName: string, status: "finalized" | "parked" | "rolled_back") =>
    TenantStepStateRepository.create({ postgres: ledger }).upsertRecord({
      migrationName,
      tenantId: ORGANIZATION,
      status,
      report: null,
    });
  const forget = async () => {
    const { tenantState } = await ledgerTables({ postgres: ledger });
    await ledger.query(`DELETE FROM ${tenantState} WHERE "tenant_id" = $1`, [ORGANIZATION]);
  };

  beforeAll(async () => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:pending-tenant-source"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    ledger = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    const tables = await ledgerTables({ postgres: ledger });
    await ledger.query(`CREATE SCHEMA IF NOT EXISTS "${tables.schema}"`);
    for (const statement of ledgerTablesDdl({ tables })) await ledger.query(statement);
    await prisma.organization.create({
      data: { id: ORGANIZATION, name: ORGANIZATION, slug: ORGANIZATION },
    });
  });

  afterAll(async () => {
    await forget();
    await prisma.organization.deleteMany({ where: { id: ORGANIZATION } });
    await prisma.$disconnect();
  });

  describe("given an organization no pass has ever touched", () => {
    /** @scenario "A tenant no pass has ever touched is visited" */
    it("is walked, because it holds no record for any migration", async () => {
      await forget();

      await expect(visited()).resolves.toEqual([ORGANIZATION]);
    });
  });

  describe("given an organization finalized for one migration and parked for another", () => {
    /** @scenario "A tenant with one of a pass's migrations still to finish is visited" */
    it("is walked, because one of the migrations still has work for it", async () => {
      await forget();
      await record(DRIVEN[0]!, "finalized");
      await record(DRIVEN[1]!, "parked");

      await expect(visited()).resolves.toEqual([ORGANIZATION]);
    });
  });

  describe("given an organization finalized for every migration the pass drives", () => {
    /** @scenario "A tenant that has finished every migration a pass drives is not visited again" */
    it("is not walked at all", async () => {
      await forget();
      await record(DRIVEN[0]!, "finalized");
      await record(DRIVEN[1]!, "finalized");

      await expect(visited()).resolves.toEqual([]);
    });
  });

  describe("given an organization an operator rolled back for every migration the pass drives", () => {
    /** @scenario "A tenant an operator rolled back is not visited again" */
    it("is not walked at all, because the pin is as final as a finalized record", async () => {
      await forget();
      await record(DRIVEN[0]!, "rolled_back");
      await record(DRIVEN[1]!, "rolled_back");

      await expect(visited()).resolves.toEqual([]);
    });
  });
});
