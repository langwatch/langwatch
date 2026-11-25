/**
 * @vitest-environment node
 * The usage page's seat counts leave a Billing-only member or invitation out of every pool.
 * @see ../../../../../../../specs/licensing/billing-only-invite.feature
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

import { PrismaMemberSeatRepository } from "../prisma.member-seat.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaMemberSeatRepository", () => {
  const ns = `member-seat-${randomUUID().slice(0, 8)}`;
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient;
  let organizationId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:entitlement:test:member-seat-repository"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    organizationId = (
      await prisma.organization.create({ data: { name: `Org ${ns}`, slug: `org-${ns}` } })
    ).id;
    for (const [label, role, billingOnly] of [
      ["admin", "ADMIN", false],
      ["viewer", "EXTERNAL", false],
      ["payer", "EXTERNAL", true],
    ] as const) {
      const user = await prisma.user.create({ data: { email: `${label}-${ns}@acme.test` } });
      userIds.push(user.id);
      await prisma.organizationUser.create({
        data: { userId: user.id, organizationId, role, billingOnly },
      });
    }
    await prisma.organizationInvite.create({
      data: {
        email: `finance-${ns}@acme.test`,
        inviteCode: `code-${ns}`,
        organizationId,
        teamIds: "",
        role: "EXTERNAL",
        billingOnly: true,
        expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  /** @scenario "Accepting a Billing-only invite takes no seat" */
  it("counts the admin and the Lite viewer, and neither Billing-only seat", async () => {
    const seats = await PrismaMemberSeatRepository.create(prisma).countMemberSeats({
      organizationId,
    });

    expect(seats).toEqual({ fullMembers: 1, liteMembers: 1, developers: 0 });
  });
});
