/**
 * @vitest-environment node
 * Who a migration pass visits at all, asked of a real Postgres: the narrowed
 * walk is a counted subquery over the per-tenant state table.
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

import { PrismaOrganizationTenantSourceRepository } from "../prisma.organization-tenant-source.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

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

  const record = (migrationName: string, status: string) =>
    prisma.systemMigrationTenantState.create({
      data: { migrationName, tenantId: ORGANIZATION, status },
    });

  beforeAll(async () => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:ops:test:pending-tenant-source"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    await prisma.organization.create({
      data: { id: ORGANIZATION, name: ORGANIZATION, slug: ORGANIZATION },
    });
  });

  afterAll(async () => {
    await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: ORGANIZATION } });
    await prisma.organization.deleteMany({ where: { id: ORGANIZATION } });
    await prisma.$disconnect();
  });

  describe("given an organization no pass has ever touched", () => {
    /** @scenario "A tenant no pass has ever touched is visited" */
    it("is walked, because it holds no record for any migration", async () => {
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: ORGANIZATION } });

      await expect(visited()).resolves.toEqual([ORGANIZATION]);
    });
  });

  describe("given an organization finalized for one migration and parked for another", () => {
    /** @scenario "A tenant with one of a pass's migrations still to finish is visited" */
    it("is walked, because one of the migrations still has work for it", async () => {
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: ORGANIZATION } });
      await record(DRIVEN[0]!, "finalized");
      await record(DRIVEN[1]!, "parked");

      await expect(visited()).resolves.toEqual([ORGANIZATION]);
    });
  });

  describe("given an organization finalized for every migration the pass drives", () => {
    /** @scenario "A tenant that has finished every migration a pass drives is not visited again" */
    it("is not walked at all", async () => {
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: ORGANIZATION } });
      await record(DRIVEN[0]!, "finalized");
      await record(DRIVEN[1]!, "finalized");

      await expect(visited()).resolves.toEqual([]);
    });
  });

  describe("given an organization an operator rolled back for every migration the pass drives", () => {
    /** @scenario "A tenant an operator rolled back is not visited again" */
    it("is not walked at all, because the pin is as final as a finalized record", async () => {
      await prisma.systemMigrationTenantState.deleteMany({ where: { tenantId: ORGANIZATION } });
      await record(DRIVEN[0]!, "rolled_back");
      await record(DRIVEN[1]!, "rolled_back");

      await expect(visited()).resolves.toEqual([]);
    });
  });
});
