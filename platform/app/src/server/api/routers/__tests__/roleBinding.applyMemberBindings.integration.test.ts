/**
 * @vitest-environment node
 *
 * The saved batch describes the state the admin wants, so re-asserting
 * something already true is a success, not an error.
 *
 * A customer reducing seats hit the opposite three ways in one afternoon:
 * re-adding a row the member already held failed as an unknown error (the
 * duplicate tripped a unique index), removing a row while picking a Lite
 * Member seat failed with "one or more bindings not found" (the seat change
 * had already rewritten the member's team rows, so the staged ids were
 * stale), and the failures left the dialog showing rows the save had in
 * fact already changed. These suites drive the same calls the dialog makes,
 * in the same order.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  afterAll,
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
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "../../../db";
import {
  createSeatChangeFixture,
  type SeatChangeFixture,
} from "./seatChangeLastTeamAdminFixture";

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

let fixture: SeatChangeFixture;

const soloTeamBinding = (teamId: string) =>
  prisma.roleBinding.findFirst({
    where: {
      organizationId: fixture.organizationId,
      userId: fixture.soloUserId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });

const applyForSoloUser = ({
  bindingIdsToDelete = [],
  bindingsToCreate = [],
}: {
  bindingIdsToDelete?: string[];
  bindingsToCreate?: Array<{
    role: TeamUserRole;
    customRoleId?: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }>;
}) =>
  fixture.callerAsAdmin().roleBinding.applyMemberBindings({
    organizationId: fixture.organizationId,
    userId: fixture.soloUserId,
    bindingIdsToDelete,
    bindingsToCreate,
  });

describe("given an organization admin editing a member's access", () => {
  beforeAll(async () => {
    fixture = await createSeatChangeFixture({
      prisma,
      ns: `member-access-${nanoid(8)}`,
    });
  });

  beforeEach(() => fixture.resetMemberships());

  afterAll(() => fixture.cleanup());

  describe("when they re-add an access row the member already holds", () => {
    /** @scenario Re-adding an access row the member already holds saves cleanly */
    it("saves cleanly and keeps the access exactly once", async () => {
      await expect(
        applyForSoloUser({
          bindingsToCreate: [
            {
              role: TeamUserRole.ADMIN,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: fixture.onlyAdminTeamId,
            },
          ],
        }),
      ).resolves.toMatchObject({ success: true });

      await expect(
        prisma.roleBinding.count({
          where: {
            organizationId: fixture.organizationId,
            userId: fixture.soloUserId,
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: fixture.onlyAdminTeamId,
          },
        }),
      ).resolves.toBe(1);
    });

    /** @scenario Re-adding an access row the member already holds saves cleanly */
    it("stages the same addition twice without failing", async () => {
      const addition = {
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: fixture.sharedWithAnotherAdminTeamId,
      };

      await expect(
        applyForSoloUser({ bindingsToCreate: [addition, addition] }),
      ).resolves.toMatchObject({ success: true });

      await expect(
        prisma.roleBinding.count({
          where: {
            organizationId: fixture.organizationId,
            userId: fixture.soloUserId,
            role: TeamUserRole.MEMBER,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: fixture.sharedWithAnotherAdminTeamId,
          },
        }),
      ).resolves.toBe(1);
    });
  });

  describe("when a staged removal points at a row that is already gone", () => {
    /** @scenario Removing an access row that is already gone saves cleanly */
    it("saves cleanly", async () => {
      const binding = await soloTeamBinding(fixture.onlyAdminTeamId);
      await prisma.roleBinding.delete({ where: { id: binding!.id } });

      await expect(
        applyForSoloUser({ bindingIdsToDelete: [binding!.id] }),
      ).resolves.toMatchObject({ success: true });
    });
  });

  describe("when the seat change corrected the rows before the bindings applied", () => {
    /** @scenario Moving to a Lite Member seat while removing an access row saves cleanly */
    it("saves the whole edit cleanly, and the removal lands", async () => {
      // The dialog's exact order: the removal ids are staged before the save,
      // the organization role applies first and corrects every team row down
      // to Viewer, and only then does the binding batch arrive.
      const stagedBinding = await soloTeamBinding(fixture.onlyAdminTeamId);

      await fixture.callerAsAdmin().organization.updateMemberRole({
        organizationId: fixture.organizationId,
        userId: fixture.soloUserId,
        role: OrganizationUserRole.EXTERNAL,
      });

      // The correction updates the row in place, so the id the admin staged
      // still names the same row after the seat change.
      await expect(
        soloTeamBinding(fixture.onlyAdminTeamId),
      ).resolves.toMatchObject({
        id: stagedBinding!.id,
        role: TeamUserRole.VIEWER,
      });

      await expect(
        applyForSoloUser({ bindingIdsToDelete: [stagedBinding!.id] }),
      ).resolves.toMatchObject({ success: true });

      // Which is why the removal the admin decided on is honoured, rather
      // than silently superseded by the correction.
      await expect(
        soloTeamBinding(fixture.onlyAdminTeamId),
      ).resolves.toBeNull();
      await expect(fixture.organizationRoleOfSoloUser()).resolves.toBe(
        OrganizationUserRole.EXTERNAL,
      );
    });
  });

  describe("when the staged removals name another principal's rows", () => {
    /** @scenario A member's save cannot remove another principal's access */
    it("leaves the other member's row alone", async () => {
      const companionBinding = await prisma.roleBinding.findFirst({
        where: {
          organizationId: fixture.organizationId,
          userId: fixture.companionUserId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: fixture.sharedWithAnotherAdminTeamId,
        },
      });

      await expect(
        applyForSoloUser({ bindingIdsToDelete: [companionBinding!.id] }),
      ).resolves.toMatchObject({ success: true });

      await expect(
        prisma.roleBinding.findUnique({
          where: { id: companionBinding!.id },
        }),
      ).resolves.not.toBeNull();
    });

    /** @scenario A member's save cannot remove another principal's access */
    it("leaves a group's row alone", async () => {
      const group = await prisma.group.create({
        data: {
          organizationId: fixture.organizationId,
          name: "Reviewers",
          slug: `reviewers-${nanoid(6)}`,
        },
      });
      const groupBinding = await prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: fixture.organizationId,
          groupId: group.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: fixture.sharedWithAnotherAdminTeamId,
        },
      });

      try {
        await expect(
          applyForSoloUser({ bindingIdsToDelete: [groupBinding.id] }),
        ).resolves.toMatchObject({ success: true });

        await expect(
          prisma.roleBinding.findUnique({ where: { id: groupBinding.id } }),
        ).resolves.not.toBeNull();
      } finally {
        await prisma.roleBinding.deleteMany({ where: { id: groupBinding.id } });
        await prisma.group.deleteMany({ where: { id: group.id } });
      }
    });
  });

  describe("given the member is on a Lite Member seat", () => {
    beforeEach(async () => {
      // The dialog's order: the seat lands first, the batch follows, so the
      // batch is validated against the seat the member is on by the time it
      // runs.
      await fixture.callerAsAdmin().organization.updateMemberRole({
        organizationId: fixture.organizationId,
        userId: fixture.soloUserId,
        role: OrganizationUserRole.EXTERNAL,
      });
    });

    /** @scenario The access batch refuses an access row above Viewer for a member on a Lite Member seat */
    it("refuses a team row above Viewer, writing nothing", async () => {
      await expect(
        applyForSoloUser({
          bindingsToCreate: [
            {
              role: TeamUserRole.ADMIN,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: fixture.sharedWithAnotherAdminTeamId,
            },
          ],
        }),
      ).rejects.toMatchObject({
        cause: { code: "lite_member_viewer_only" },
      });

      await expect(
        prisma.roleBinding.count({
          where: {
            organizationId: fixture.organizationId,
            userId: fixture.soloUserId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: fixture.sharedWithAnotherAdminTeamId,
            role: TeamUserRole.ADMIN,
          },
        }),
      ).resolves.toBe(0);
    });

    /** @scenario The access batch refuses an access row above Viewer for a member on a Lite Member seat */
    it("refuses a project row above Viewer", async () => {
      await expect(
        applyForSoloUser({
          bindingsToCreate: [
            {
              role: TeamUserRole.MEMBER,
              scopeType: RoleBindingScopeType.PROJECT,
              scopeId: fixture.sharedProjectId,
            },
          ],
        }),
      ).rejects.toMatchObject({
        cause: { code: "lite_member_viewer_only" },
      });
    });

    /** @scenario The access batch refuses a custom role for a member on a Lite Member seat */
    it("refuses a custom role row", async () => {
      const customRole = await prisma.customRole.create({
        data: {
          organizationId: fixture.organizationId,
          name: `Deployer ${nanoid(6)}`,
          permissions: ["traces:view"],
          kind: "custom",
        },
      });

      try {
        await expect(
          applyForSoloUser({
            bindingsToCreate: [
              {
                role: TeamUserRole.CUSTOM,
                customRoleId: customRole.id,
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: fixture.onlyAdminTeamId,
              },
            ],
          }),
        ).rejects.toMatchObject({
          cause: { code: "lite_member_viewer_only" },
        });
      } finally {
        await prisma.customRole.deleteMany({ where: { id: customRole.id } });
      }
    });

    /** @scenario The access batch refuses an organization access row for a member on a Lite Member seat */
    it("refuses an organization row even at Viewer", async () => {
      await expect(
        applyForSoloUser({
          bindingsToCreate: [
            {
              role: TeamUserRole.VIEWER,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: fixture.organizationId,
            },
          ],
        }),
      ).rejects.toMatchObject({
        cause: { code: "lite_member_viewer_only" },
      });
    });

    /** @scenario The access batch accepts a Viewer row for a member on a Lite Member seat */
    it("accepts a Viewer team row", async () => {
      await expect(
        applyForSoloUser({
          bindingsToCreate: [
            {
              role: TeamUserRole.VIEWER,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: fixture.sharedWithAnotherAdminTeamId,
            },
          ],
        }),
      ).resolves.toMatchObject({ success: true });

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.sharedWithAnotherAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.VIEWER);
    });
  });

  describe("when the organization is not on an Enterprise plan", () => {
    /** @scenario Group access is listed on every plan */
    it("lists the member's groups rather than refusing", async () => {
      // Group bindings grant permissions on every plan (rbac resolves them
      // with no plan check), so the member dialog reads them on every plan
      // too. This fixture's plan is FREE.
      const group = await prisma.group.create({
        data: {
          organizationId: fixture.organizationId,
          name: "Analysts",
          slug: `analysts-${nanoid(6)}`,
        },
      });
      await prisma.groupMembership.create({
        data: { userId: fixture.soloUserId, groupId: group.id },
      });
      const groupBinding = await prisma.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: fixture.organizationId,
          groupId: group.id,
          role: TeamUserRole.VIEWER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: fixture.onlyAdminTeamId,
        },
      });

      try {
        const groups = await fixture.callerAsAdmin().group.listForMember({
          organizationId: fixture.organizationId,
          userId: fixture.soloUserId,
        });

        expect(groups).toMatchObject([
          {
            name: "Analysts",
            bindings: [{ role: TeamUserRole.VIEWER }],
          },
        ]);
      } finally {
        await prisma.roleBinding.deleteMany({ where: { id: groupBinding.id } });
        await prisma.groupMembership.deleteMany({
          where: { groupId: group.id },
        });
        await prisma.group.deleteMany({ where: { id: group.id } });
      }
    });
  });
});
