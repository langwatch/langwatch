/**
 * The member listing step's read against Postgres: a page of organizations in id order and their
 * memberships, disabled ones and deactivated users left out.
 * @vitest-environment node
 * @see modules/organization/specs/organization-service.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository active member page", () => {
  const tag = nanoid(8).toLowerCase();
  // Every id here starts with the prefix, so a page read after it holds only this test's rows.
  const prefix = `org-memberlist-${tag}`;
  const acme = `${prefix}-a`;
  const beta = `${prefix}-b`;
  const active = `user-memberlist-active-${tag}`;
  const disabled = `user-memberlist-disabled-${tag}`;
  const deactivated = `user-memberlist-deactivated-${tag}`;
  const userIds = [active, disabled, deactivated];
  const joinedAt = new Date("2025-03-01T09:00:00.000Z");

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:active-member-page"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

  beforeAll(async () => {
    for (const id of [acme, beta]) {
      await prisma.organization.create({ data: { id, name: id, slug: id } });
    }
    for (const id of userIds) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@acme.test`,
          ...(id === deactivated ? { deactivatedAt: new Date() } : {}),
        },
      });
      await prisma.organizationUser.create({
        data: {
          userId: id,
          organizationId: acme,
          role: "MEMBER",
          createdAt: joinedAt,
          ...(id === disabled ? { disabledAt: new Date() } : {}),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: [acme, beta] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: [acme, beta] } } });
    await connection.closeOnce();
  });

  /** @scenario "The member listing reads only active memberships from Postgres" */
  it("lists only the active member, with its membership's creation time", async () => {
    const page = await repository.findActiveMemberPage({ afterId: prefix, limit: 2 });

    expect(page.lastOrganizationId).toBe(beta);
    expect(page.organizations).toBe(2);
    expect(
      page.members.map((row) => [row.organizationId, row.userId, row.joinedAt.epochMilliseconds]),
    ).toEqual([[acme, active, joinedAt.getTime()]]);
  });
});
