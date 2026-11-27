/**
 * @vitest-environment node
 * Every invitation of one organization, whatever its status, newest first, and none of another
 * organization's (ADR-202, ops functions: org.invites).
 * @see modules/organization/specs/invitations.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaOrganizationInviteRepository } from "../prisma.organization-invite.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("findAllInvites (Postgres)", () => {
  const ns = `org-all-invites-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:all-invites"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const invites = PrismaOrganizationInviteRepository.create({ database: prisma });
  const organizationIds: string[] = [];

  async function organization(label: string): Promise<string> {
    const created = await prisma.organization.create({
      data: { name: label, slug: `--${ns}-${label}` },
    });
    organizationIds.push(created.id);
    return created.id;
  }

  async function invite({
    organizationId,
    label,
    status,
    createdAt,
  }: {
    organizationId: string;
    label: string;
    status: "PENDING" | "ACCEPTED" | "REVOKED" | "PAYMENT_PENDING";
    createdAt: Date;
  }): Promise<string> {
    const row = await prisma.organizationInvite.create({
      data: {
        email: `${label}-${ns}@acme.test`,
        inviteCode: `${label}-${ns}`,
        organizationId,
        teamIds: "",
        role: "MEMBER",
        status,
        createdAt,
      },
    });
    return row.id;
  }

  afterAll(async () => {
    await prisma.organizationInvite.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  /** @scenario "Every invitation of an organization reads newest first with the status a person sees" */
  it("answers every status of this organization only, newest first", async () => {
    const acme = await organization("acme");
    const other = await organization("other");
    const accepted = await invite({
      organizationId: acme,
      label: "accepted",
      status: "ACCEPTED",
      createdAt: new Date("2026-11-01T00:00:00Z"),
    });
    const checkout = await invite({
      organizationId: acme,
      label: "checkout",
      status: "PAYMENT_PENDING",
      createdAt: new Date("2026-11-02T00:00:00Z"),
    });
    const revoked = await invite({
      organizationId: acme,
      label: "revoked",
      status: "REVOKED",
      createdAt: new Date("2026-11-03T00:00:00Z"),
    });
    await invite({
      organizationId: other,
      label: "elsewhere",
      status: "PENDING",
      createdAt: new Date("2026-11-04T00:00:00Z"),
    });

    const found = await invites.findAllInvites({ organizationId: acme });

    expect(found.map(({ id, status }) => [id, status])).toEqual([
      [revoked, "REVOKED"],
      [checkout, "PAYMENT_PENDING"],
      [accepted, "ACCEPTED"],
    ]);
  });

  /** @scenario "An organization with no invitations reads as an empty list" */
  it("answers an empty list for an organization with none", async () => {
    const empty = await organization("empty");

    await expect(invites.findAllInvites({ organizationId: empty })).resolves.toEqual([]);
  });
});
