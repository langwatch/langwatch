/**
 * @vitest-environment node
 *
 * The Developer seat (ADR-143), on the paths that settle the design.
 *
 * A Developer holds their personal team and nothing shared. Moving a Full
 * member onto the seat has to DELETE their shared access, not correct it, and
 * the proof is not a row count: it is the engine refusing `traces:view` on the
 * shared project afterwards while the personal project still answers. Keys
 * are not revoked on the way; a user-owned key is clamped to what its owner
 * may do right now, so the shared-project key stops working on its own.
 *
 * Spec: specs/members/developer-seat.feature
 * Requires: PostgreSQL database (Prisma)
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { resolveApiKeyPermission } from "~/server/app-layer/authz/credential-permissions";
import { resolveProjectPermission } from "~/server/app-layer/authz/permission-adapters";
import { liveGrants } from "~/server/app-layer/authz/repositories/live-rows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { seedRoleBinding } from "../../../../test-utils/authz-seeds";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { prisma } from "../../../db";
import {
  createSeatChangeFixture,
  type SeatChangeFixture,
} from "./seatChangeLastTeamAdminFixture";

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

let fixture: SeatChangeFixture;

const moveSoloUserTo = (role: OrganizationUserRole) =>
  fixture.callerAsAdmin().organization.updateMemberRole({
    organizationId: fixture.organizationId,
    userId: fixture.soloUserId,
    role,
  });

/** The engine's own answer for the solo user on one project. */
const soloMay = (projectId: string) =>
  resolveProjectPermission(
    {
      prisma,
      session: {
        user: { id: fixture.soloUserId, name: "Solo", email: "" },
        expires: "1",
      } as any,
    },
    projectId,
    "traces:view",
  );

/** The organisation-wide row every Full member holds and a Developer must not. */
const seedOrganizationRowForSolo = () =>
  seedRoleBinding(prisma, {
    id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    organizationId: fixture.organizationId,
    userId: fixture.soloUserId,
    role: TeamUserRole.MEMBER,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: fixture.organizationId,
  });

const liveRowsOfSolo = (where: {
  scopeType: RoleBindingScopeType;
  scopeId: string;
}) =>
  liveGrants(prisma).findMany({
    where: {
      organizationId: fixture.organizationId,
      principalType: "USER",
      principalId: fixture.soloUserId,
      ...where,
    },
    select: { id: true },
  });

describe("given a Full member on three shared teams, a shared project, and the organisation", () => {
  beforeAll(async () => {
    fixture = await createSeatChangeFixture({
      prisma,
      ns: `dev-seat-${nanoid(8)}`,
    });
  });

  beforeEach(async () => {
    await fixture.resetMemberships();
    await seedOrganizationRowForSolo();
  });

  afterEach(async () => {
    // The keys a test minted hold access rows of their own, and those rows
    // restrict the key's deletion, so they go first.
    const mintedKeyIds = (
      await prisma.apiKey.findMany({
        where: {
          organizationId: fixture.organizationId,
          userId: fixture.soloUserId,
        },
        select: { id: true },
      })
    ).map((key) => key.id);
    await cleanupTestRows(prisma, [
      [
        "roleBinding",
        {
          organizationId: fixture.organizationId,
          userId: fixture.soloUserId,
          scopeType: RoleBindingScopeType.ORGANIZATION,
        },
      ],
      ...(mintedKeyIds.length > 0
        ? ([
            [
              "roleBinding",
              {
                organizationId: fixture.organizationId,
                apiKeyId: { in: mintedKeyIds },
              },
            ],
            [
              "grant",
              {
                organizationId: fixture.organizationId,
                principalType: "API_KEY",
                principalId: { in: mintedKeyIds },
              },
            ],
            ["apiKey", { id: { in: mintedKeyIds } }],
          ] as const)
        : []),
    ]);
  });

  afterAll(() => fixture.cleanup());

  describe("when an organisation admin moves them to the Developer seat", () => {
    /** @scenario Downgrading a Full member to Developer removes shared access */
    it("saves the seat and deletes every shared team row", async () => {
      await expect(
        moveSoloUserTo(OrganizationUserRole.DEVELOPER),
      ).resolves.toMatchObject({ success: true });

      await expect(fixture.organizationRoleOfSoloUser()).resolves.toBe(
        OrganizationUserRole.DEVELOPER,
      );
      for (const teamId of [
        fixture.onlyAdminTeamId,
        fixture.alsoOnlyAdminTeamId,
        fixture.sharedWithAnotherAdminTeamId,
      ]) {
        await expect(
          fixture.teamRoleOf({ userId: fixture.soloUserId, teamId }),
        ).resolves.toBeNull();
      }
    });

    /** @scenario Downgrading a Full member to Developer removes shared access */
    it("deletes the organisation-wide row and the shared project row", async () => {
      await moveSoloUserTo(OrganizationUserRole.DEVELOPER);

      await expect(
        liveRowsOfSolo({
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: fixture.organizationId,
        }),
      ).resolves.toEqual([]);
      await expect(
        fixture.projectBindingOf({
          userId: fixture.soloUserId,
          projectId: fixture.sharedProjectId,
        }),
      ).resolves.toBeNull();
    });

    /** @scenario Downgrading a Full member to Developer removes shared access */
    it("records each deletion on the ledger with the seat as the reason", async () => {
      await moveSoloUserTo(OrganizationUserRole.DEVELOPER);

      const revoked = await prisma.grant.findMany({
        where: {
          organizationId: fixture.organizationId,
          principalType: "USER",
          principalId: fixture.soloUserId,
          scopeId: {
            in: [
              fixture.onlyAdminTeamId,
              fixture.alsoOnlyAdminTeamId,
              fixture.sharedWithAnotherAdminTeamId,
              fixture.sharedProjectId,
              fixture.organizationId,
            ],
          },
        },
        select: { revokedAt: true, scopeId: true },
      });
      expect(revoked.length).toBeGreaterThanOrEqual(5);
      expect(revoked.every((row) => row.revokedAt !== null)).toBe(true);
    });

    /** @scenario Downgrading a Full member to Developer removes shared access */
    it("keeps the personal team row, the personal project and its access", async () => {
      await moveSoloUserTo(OrganizationUserRole.DEVELOPER);

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.personalTeamId,
        }),
      ).resolves.toBe(TeamUserRole.ADMIN);
      await expect(
        prisma.project.findUnique({
          where: { id: fixture.personalProjectId },
          select: { id: true, archivedAt: true },
        }),
      ).resolves.toMatchObject({
        id: fixture.personalProjectId,
        archivedAt: null,
      });
      await expect(soloMay(fixture.personalProjectId)).resolves.toMatchObject({
        permitted: true,
      });
    });

    /** @scenario A Developer never sees a shared project */
    /** @scenario Downgrading a Full member to Developer removes shared access */
    it("is refused traces:view on the shared project by the engine, naming the seat", async () => {
      await expect(soloMay(fixture.sharedProjectId)).resolves.toMatchObject({
        permitted: true,
      });

      await moveSoloUserTo(OrganizationUserRole.DEVELOPER);

      await expect(soloMay(fixture.sharedProjectId)).resolves.toMatchObject({
        permitted: false,
        organizationRole: OrganizationUserRole.DEVELOPER,
        denialReason: "developer-restricted",
      });
    });
  });

  describe("when the member owns keys on the shared and the personal project", () => {
    /** @scenario A key on a shared project stops working after downgrade */
    it("the shared-project key stops working and the personal one keeps working, with no revocation", async () => {
      const apiKeys = ApiKeyService.create(prisma);
      const mint = (projectId: string, teamId: string) =>
        apiKeys
          .create({
            name: `dev-seat-key-${projectId}`,
            userId: fixture.soloUserId,
            createdByUserId: fixture.soloUserId,
            organizationId: fixture.organizationId,
            permissionMode: "all",
            bindings: [
              {
                role: TeamUserRole.ADMIN,
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: teamId,
              },
            ],
          })
          .then((minted) => ({ id: minted.apiKey.id, projectId, teamId }));

      const sharedKey = await mint(
        fixture.sharedProjectId,
        fixture.onlyAdminTeamId,
      );
      const personalKey = await mint(
        fixture.personalProjectId,
        fixture.personalTeamId,
      );
      const may = (key: { id: string; projectId: string; teamId: string }) =>
        resolveApiKeyPermission({
          prisma,
          apiKeyId: key.id,
          userId: fixture.soloUserId,
          organizationId: fixture.organizationId,
          scope: { type: "project", id: key.projectId, teamId: key.teamId },
          permission: "traces:view",
        });

      await expect(may(sharedKey)).resolves.toBe(true);

      await moveSoloUserTo(OrganizationUserRole.DEVELOPER);

      await expect(may(sharedKey)).resolves.toBe(false);
      await expect(may(personalKey)).resolves.toBe(true);
      await expect(
        prisma.apiKey.findMany({
          where: { id: { in: [sharedKey.id, personalKey.id] } },
          select: { revokedAt: true },
        }),
      ).resolves.toEqual([{ revokedAt: null }, { revokedAt: null }]);
    });
  });

  describe("when an admin then tries to give the Developer a role on a shared team", () => {
    /** @scenario A Developer cannot be given a role on a shared team */
    it("is refused with the seat named, and the Developer still holds the personal team only", async () => {
      await moveSoloUserTo(OrganizationUserRole.DEVELOPER);

      await expect(
        fixture.callerAsAdmin().organization.updateTeamMemberRole({
          teamId: fixture.sharedWithAnotherAdminTeamId,
          userId: fixture.soloUserId,
          role: TeamUserRole.MEMBER,
        }),
      ).rejects.toMatchObject({
        cause: { code: "developer_seat_no_shared_access" },
      });

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.sharedWithAnotherAdminTeamId,
        }),
      ).resolves.toBeNull();
    });
  });
});
