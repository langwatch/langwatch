/**
 * A seat change whose grant corrections the ledger accepted but could not confirm keeps the new
 * seat; one the ledger refused puts the old seat back.
 * @vitest-environment node
 * @see specs/members/member-role-team-restrictions.feature
 */
import { AuthzGrantNotConfirmedError, type AuthzGrantsService } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** A ledger whose role changes all fail with `failure`, recording what it was asked. */
function failingGrantsWriter({ failure }: { failure: () => Error }) {
  const calls = { changes: 0, invalidations: 0 };
  const writer = createApiFixture<AuthzGrantsService>({
    attachBindings: async () => ({ attached: [], duplicates: [] }),
    revokeBindings: async () => undefined,
    revokeBindingsWhere: async () => 0,
    changeBindingRole: async () => {
      calls.changes += 1;
      throw failure();
    },
    invalidateOrganization: async () => {
      calls.invalidations += 1;
    },
  });
  return { writer, calls };
}

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.updateMemberRole — unconfirmed and refused corrections",
  () => {
    const suffix = nanoid(8);
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:membership-unconfirmed-grants"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;

    let organizationId: string;
    let adminUserId: string;
    let sharedTeamId: string;
    const memberIds: string[] = [];

    /** A member holding MEMBER on the shared team, so a Lite seat corrects it to Viewer. */
    const addTeamMember = async (label: string) => {
      const user = await prisma.user.create({
        data: { name: label, email: `${label}-${suffix}@example.com` },
      });
      memberIds.push(user.id);
      await prisma.organizationUser.create({
        data: { userId: user.id, organizationId, role: OrganizationUserRole.MEMBER },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: user.id,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: sharedTeamId,
          role: TeamUserRole.MEMBER,
        },
      });
      return user.id;
    };

    const seatOf = async (userId: string) =>
      (
        await prisma.organizationUser.findUniqueOrThrow({
          where: { userId_organizationId: { userId, organizationId } },
        })
      ).role;

    const moveToLite = ({ writer, userId }: { writer: AuthzGrantsService; userId: string }) =>
      PrismaOrganizationMembershipRepository.create({
        database: prisma,
        cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
        grants: writer,
      }).updateMemberRole({
        caller: { type: "system" },
        organizationId,
        userId,
        role: OrganizationUserRole.EXTERNAL,
        effectiveTeamRoleUpdates: [
          { teamId: sharedTeamId, role: TeamUserRole.VIEWER, origin: "seat-correction" },
        ],
        currentUserId: adminUserId,
      });

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: "Unconfirmed Grants Org", slug: `--test-org-${suffix}` },
      });
      organizationId = organization.id;
      const admin = await prisma.user.create({
        data: { name: "Admin", email: `admin-${suffix}@example.com` },
      });
      adminUserId = admin.id;
      await prisma.organizationUser.create({
        data: { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
      });
      const sharedTeam = await prisma.team.create({
        data: { name: "Shared Team", slug: `--test-team-shared-${suffix}`, organizationId },
      });
      sharedTeamId = sharedTeam.id;
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: adminUserId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: sharedTeamId,
          role: TeamUserRole.ADMIN,
        },
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["roleBinding", { organizationId }],
        ["team", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: { in: [adminUserId, ...memberIds] } }],
      ]);
      await prisma.$disconnect();
    });

    describe("when the ledger accepts the correction but cannot confirm it in time", () => {
      /** @scenario "A seat change whose access rows have not landed yet keeps the new seat" */
      it("saves the Lite seat, still commands the correction and drops the cached access", async () => {
        const userId = await addTeamMember("unconfirmed");
        const { writer, calls } = failingGrantsWriter({
          failure: () => new AuthzGrantNotConfirmedError(),
        });

        await expect(moveToLite({ writer, userId })).resolves.toEqual({
          teamsLeftWithoutAdmin: [],
        });

        await expect(seatOf(userId)).resolves.toBe(OrganizationUserRole.EXTERNAL);
        expect(calls.changes).toBe(1);
        expect(calls.invalidations).toBe(1);
      });
    });

    describe("when the ledger refuses the correction", () => {
      /** @scenario "A seat change whose access rows are refused goes back to the old seat" */
      it("refuses the change and puts the Member seat back", async () => {
        const userId = await addTeamMember("refused");
        const { writer, calls } = failingGrantsWriter({
          failure: () => new Error("ledger refused the append"),
        });

        await expect(moveToLite({ writer, userId })).rejects.toThrow("ledger refused the append");

        await expect(seatOf(userId)).resolves.toBe(OrganizationUserRole.MEMBER);
        expect(calls.invalidations).toBe(0);
      });
    });
  },
);
