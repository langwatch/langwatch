// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/governance/governance-identity-and-erasure.feature
 */
import { readFileSync } from "node:fs";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaGovernanceTenantHistoryRepository } from "../prisma.governance-tenant-history.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:governance:test:tenant-history"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : undefined;

describe.skipIf(!connection)("PrismaGovernanceTenantHistoryRepository", () => {
  const ns = `tenant-history-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const LEGACY_ORG_ID = `org-legacy-${ns}`;
  const LEGACY_TEAM_ID = `team-legacy-${ns}`;

  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const repository = () => PrismaGovernanceTenantHistoryRepository.create(prisma());
  const at = (offsetDays: number) => fromDate(new Date(Date.UTC(2026, 0, 1 + offsetDays)));

  afterAll(async () => {
    await prisma().governanceTenantHistory.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma().governanceTenantHistory.deleteMany({ where: { organizationId: LEGACY_ORG_ID } });
    await prisma().project.deleteMany({ where: { teamId: LEGACY_TEAM_ID } });
    await prisma().team.deleteMany({ where: { id: LEGACY_TEAM_ID } });
    await prisma().organization.deleteMany({ where: { id: LEGACY_ORG_ID } });
  });

  describe("given an organization that used one governance area and then another", () => {
    /** @scenario "Areas the organization used before today are still found after one is retired" */
    it("returns both areas when the whole history is asked for, oldest first", async () => {
      await repository().append({ organizationId: ORG_ID, tenantId: `old-${ns}`, at: at(0) });
      await repository().append({ organizationId: ORG_ID, tenantId: `new-${ns}`, at: at(30) });

      const history = await repository().findAllByOrganization({ organizationId: ORG_ID });

      expect(history.map((row) => row.tenantId)).toEqual([`old-${ns}`, `new-${ns}`]);
    });
  });
  describe("given organizations that ingested before the records were introduced", () => {
    const BACKFILL_MIGRATION = new URL(
      "../../../../../../../../packages/prisma-client/prisma/migrations/20260907120002_governance_identity_and_erasure/migration.sql",
      import.meta.url,
    );
    const LIVE_AREA = `live-${ns}`;
    const RETIRED_AREA = `retired-${ns}`;

    /** @scenario "Organizations that already ingested keep their area when the records are introduced" */
    it("files every existing governance area in its organization's history, retired ones included", async () => {
      const backfill = readFileSync(BACKFILL_MIGRATION, "utf8").match(
        /INSERT INTO "GovernanceTenantHistory"[\s\S]*?;/,
      )?.[0];
      expect(backfill).toBeDefined();
      await prisma().organization.create({
        data: { id: LEGACY_ORG_ID, name: LEGACY_ORG_ID, slug: LEGACY_ORG_ID },
      });
      await prisma().team.create({
        data: {
          id: LEGACY_TEAM_ID,
          name: LEGACY_TEAM_ID,
          slug: LEGACY_TEAM_ID,
          organizationId: LEGACY_ORG_ID,
        },
      });
      for (const [id, archivedAt] of [
        [LIVE_AREA, null],
        [RETIRED_AREA, new Date(Date.UTC(2026, 0, 2))],
      ] as const) {
        await prisma().project.create({
          data: {
            id,
            name: id,
            slug: id,
            teamId: LEGACY_TEAM_ID,
            language: "en",
            framework: "openai",
            apiKey: `key-${id}`,
            kind: "internal_governance",
            archivedAt,
          },
        });
      }

      await prisma().$executeRawUnsafe(backfill ?? "");

      const history = await repository().findAllByOrganization({ organizationId: LEGACY_ORG_ID });
      expect(history.map((row) => row.tenantId).toSorted()).toEqual(
        [LIVE_AREA, RETIRED_AREA].toSorted(),
      );
    });
  });
});
