// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * The two subscription reads the ops functions stand on, against Postgres: an organization's
 * rows newest first, and every row created in a range across organizations.
 * @see modules/staff-access/specs/staff-access-functions-billing.feature
 */
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaBillingSubscriptionRepository } from "../prisma.subscription.repository.ts";

const namespace = `ops-reads-${randomUUID().slice(0, 8)}`;

describe("given two organizations with subscriptions across two months", () => {
  let prisma: PrismaClient;
  let repository: PrismaBillingSubscriptionRepository;
  const organizationIds: string[] = [];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: PrismaDriverAdapterService.create().create(process.env.DATABASE_URL ?? "").adapter,
    });
    repository = PrismaBillingSubscriptionRepository.create(prisma);
    for (const name of ["acme", "globex"]) {
      const organization = await prisma.organization.create({
        data: { name: `${name} ${namespace}`, slug: `${name}-${namespace}` },
      });
      organizationIds.push(organization.id);
    }
    const [acme, globex] = organizationIds as [string, string];
    const rows = [
      { key: "acmeOld", organizationId: acme, status: "CANCELLED", at: "2026-10-05T00:00:00Z" },
      { key: "acmeNew", organizationId: acme, status: "ACTIVE", at: "2026-11-03T00:00:00Z" },
      { key: "globex", organizationId: globex, status: "PENDING", at: "2026-11-04T00:00:00Z" },
    ] as const;
    for (const row of rows) {
      const created = await prisma.subscription.create({
        data: {
          organizationId: row.organizationId,
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          status: row.status,
          createdAt: new Date(row.at),
        },
      });
      ids[row.key] = created.id;
    }
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  describe("when one organization's rows are read", () => {
    it("answers all of them, cancelled included, newest first", async () => {
      const rows = await repository.findForOrganization(organizationIds[0] ?? "");

      expect(rows.map((row) => row.id)).toEqual([ids.acmeNew, ids.acmeOld]);
    });
  });

  describe("when rows created in November are read", () => {
    it("answers both organizations' November rows and not October's", async () => {
      const rows = await repository.findCreatedBetween({
        since: Temporal.Instant.from("2026-11-01T00:00:00Z"),
        until: Temporal.Instant.from("2026-12-01T00:00:00Z"),
      });
      const ours = rows.filter((row) => organizationIds.includes(row.organizationId));

      expect(ours.map((row) => row.id)).toEqual([ids.acmeNew, ids.globex]);
    });
  });
});
