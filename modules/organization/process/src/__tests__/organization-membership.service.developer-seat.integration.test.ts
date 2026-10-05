import type { AuthzGrantsService } from "@langwatch/authz-contract";
/**
 * Moving a Full member onto the Developer seat (ADR-171) DELETES their shared access:
 * every shared team, shared project and organization row goes with the seat as its reason,
 * and the personal workspace stays as it was.
 * @vitest-environment node
 * @see specs/members/developer-seat.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
} from "../app/organization.members.ts";
import { PrismaOrganizationMembershipRepository } from "../repositories/prisma/prisma.organization-membership.repository.ts";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

interface RecordedRevocation {
  bindingIds: string[];
  reason: string | undefined;
}

/** The revocations the seat change asked the ledger for, in order. */
const revocations: RecordedRevocation[] = [];

const recordingGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindings: async ({ bindingIds, reason }) => {
    revocations.push({ bindingIds, reason });
  },
  revokeBindingsWhere: async () => 0,
  changeBindingRole: async () => {},
});

const seats: OrganizationSeatLicense = {
  checkLimit: vi.fn(),
  assertRoleChangeAllowed: vi.fn(),
};
const sessions: OrganizationSessionRevocation = { revokeAllBrowserSessions: vi.fn() };
const grantCache: OrganizationGrantCache = { invalidateOrganization: vi.fn() };
const prompts: OrganizationPromptSeed = {
  seedTagsForOrganization: vi.fn(),
  reportCompensationFailure: vi.fn(),
};

describe.skipIf(!DB_URL)(
  "given a Full member on a shared team, a shared project and the organisation",
  () => {
    const connection: PrismaConnection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:developer-seat"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;
    const memberships = OrganizationMembershipService.create({
      repository: PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants: recordingGrantsWriter,
      }),
      prompts,
      seats,
      sessions,
      grantCache,
      testArrivals: { standingFor: async () => ({ testing: false }) as const },
      ceiling: { assertWithinCaller: async () => {} },
      admissions: {
        attachBindings: () => Promise.reject(new Error("no admission expected")),
        completeAdmission: () => Promise.reject(new Error("no admission expected")),
      },
    });

    const ns = `dev-seat-${nanoid(8)}`;
    let organizationId: string;
    let adminUserId: string;
    let seatUserId: string;
    let personalTeamId: string;
    let sharedTeamId: string;
    let personalBindingId: string;
    let sharedTeamBindingId: string;
    let sharedProjectBindingId: string;
    let organizationBindingId: string;

    const binding = (data: {
      userId: string;
      role: "ADMIN" | "MEMBER";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }) => prisma.roleBinding.create({ data: { organizationId, ...data } });

    beforeAll(async () => {
      adminUserId = (
        await prisma.user.create({ data: { name: "Admin", email: `admin-${ns}@example.com` } })
      ).id;
      seatUserId = (
        await prisma.user.create({ data: { name: "Seat User", email: `seat-${ns}@example.com` } })
      ).id;
      organizationId = (
        await prisma.organization.create({
          data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
        })
      ).id;
      await prisma.organizationUser.createMany({
        data: [
          { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
          { userId: seatUserId, organizationId, role: OrganizationUserRole.MEMBER },
        ],
      });

      personalTeamId = (
        await prisma.team.create({
          data: {
            name: "Seat User's Workspace",
            slug: `--test-team-${ns}-personal`,
            organizationId,
            isPersonal: true,
            ownerUserId: seatUserId,
          },
        })
      ).id;
      await prisma.project.create({
        data: {
          name: "Personal",
          slug: `--test-proj-${ns}-personal`,
          apiKey: `sk-lw-test-${nanoid(16)}`,
          teamId: personalTeamId,
          language: "en",
          framework: "test",
          isPersonal: true,
        },
      });
      sharedTeamId = (
        await prisma.team.create({
          data: { name: `ACME ${ns}`, slug: `--test-team-${ns}-shared`, organizationId },
        })
      ).id;
      const sharedProjectId = (
        await prisma.project.create({
          data: {
            name: "Shared",
            slug: `--test-proj-${ns}-shared`,
            apiKey: `sk-lw-test-${nanoid(16)}`,
            teamId: sharedTeamId,
            language: "en",
            framework: "test",
          },
        })
      ).id;

      personalBindingId = (
        await binding({
          userId: seatUserId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: personalTeamId,
        })
      ).id;
      sharedTeamBindingId = (
        await binding({
          userId: seatUserId,
          role: "ADMIN",
          scopeType: "TEAM",
          scopeId: sharedTeamId,
        })
      ).id;
      sharedProjectBindingId = (
        await binding({
          userId: seatUserId,
          role: "MEMBER",
          scopeType: "PROJECT",
          scopeId: sharedProjectId,
        })
      ).id;
      organizationBindingId = (
        await binding({
          userId: seatUserId,
          role: "MEMBER",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        })
      ).id;
    });

    afterAll(async () => {
      if (!organizationId) return;
      await cleanupTestRows(prisma, [
        ["project", { team: { organizationId } }],
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["team", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: { in: [adminUserId, seatUserId] } }],
      ]);
      await prisma.$disconnect();
    });

    describe("when an admin moves them to the Developer seat", () => {
      let teamsLeftWithoutAdmin: { id: string; name: string }[];

      beforeAll(async () => {
        revocations.length = 0;
        ({ teamsLeftWithoutAdmin } = await memberships.changeMemberRole({
          caller: { type: "system" },
          organizationId,
          userId: seatUserId,
          role: OrganizationUserRole.DEVELOPER,
          currentUserId: adminUserId,
        }));
      });

      /** @scenario Downgrading a Full member to Developer removes shared access */
      it("saves the seat", async () => {
        await expect(
          prisma.organizationUser.findUniqueOrThrow({
            where: { userId_organizationId: { userId: seatUserId, organizationId } },
            select: { role: true },
          }),
        ).resolves.toMatchObject({ role: OrganizationUserRole.DEVELOPER });
      });

      /** @scenario Downgrading a Full member to Developer removes shared access */
      it("revokes the shared team, shared project and organisation rows, naming the seat", () => {
        const developerRevocations = revocations.filter(
          (revocation) => revocation.reason === "seat changed to Developer",
        );
        expect(
          developerRevocations.flatMap((revocation) => revocation.bindingIds).toSorted(),
        ).toEqual([sharedTeamBindingId, sharedProjectBindingId, organizationBindingId].toSorted());
      });

      /** @scenario Downgrading a Full member to Developer removes shared access */
      it("leaves their personal workspace row alone", () => {
        expect(revocations.flatMap((revocation) => revocation.bindingIds)).not.toContain(
          personalBindingId,
        );
      });

      /** @scenario Downgrading a Full member to Developer removes shared access */
      it("names the shared team the move leaves without a team admin", () => {
        expect(teamsLeftWithoutAdmin.map((team) => team.id)).toEqual([sharedTeamId]);
      });
    });
  },
);
