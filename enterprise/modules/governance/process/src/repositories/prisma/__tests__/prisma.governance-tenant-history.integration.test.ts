// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/governance/governance-identity-and-erasure.feature
 */
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

  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const repository = () => PrismaGovernanceTenantHistoryRepository.create(prisma());
  const at = (offsetDays: number) => fromDate(new Date(Date.UTC(2026, 0, 1 + offsetDays)));

  afterAll(async () => {
    await prisma().governanceTenantHistory.deleteMany({ where: { organizationId: ORG_ID } });
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
});
