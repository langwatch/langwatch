/**
 * @vitest-environment node
 * The member-department column governance's departments read and write.
 * The dated links are governance's own.
 */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ACME = "org_acme";
const OTHER = "org_other";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function harness() {
  const memory = MemoryOrganizationDatabase.create();
  const member = (userId: string, organizationId: string, departmentId: string | null = null) => {
    memory.users.set(userId, {
      id: userId,
      name: null,
      email: `${userId}@acme.com`,
      deactivatedAt: null,
    });
    memory.organizationUsers.push({
      userId,
      organizationId,
      role: OrganizationUserRole.MEMBER,
      disabledAt: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
      departmentId,
    });
  };
  return { member, memory, repository: MemoryOrganizationMembershipRepository.create({ memory }) };
}

describe("the member department column", () => {
  describe("when asked for named members' departments", () => {
    it("answers only the named members of that organization", async () => {
      const { member, repository } = harness();
      member("maria", ACME, "dept_eng");
      member("tom", ACME);
      member("sam", ACME, "dept_ops");
      member("maria", OTHER, "dept_elsewhere");

      const rows = await repository.findMemberDepartments({
        organizationId: ACME,
        userIds: ["maria", "tom", "nobody"],
      });

      expect(rows).toEqual([
        { userId: "maria", departmentId: "dept_eng" },
        { userId: "tom", departmentId: null },
      ]);
    });
  });

  describe("when every member is listed with their department", () => {
    it("carries each member's name and email beside the column", async () => {
      const { member, repository } = harness();
      member("maria", ACME, "dept_eng");
      member("tom", OTHER);

      expect(await repository.findMembersWithDepartments({ organizationId: ACME })).toEqual([
        {
          userId: "maria",
          departmentId: "dept_eng",
          user: { name: null, email: "maria@acme.com" },
        },
      ]);
    });
  });

  describe("when a member is pointed at a department", () => {
    it("moves only that organization's row and reports whether one existed", async () => {
      const { member, repository } = harness();
      member("maria", ACME);
      member("maria", OTHER, "dept_elsewhere");

      await expect(
        repository.assignMemberDepartment({
          organizationId: ACME,
          userId: "maria",
          departmentId: "dept_eng",
        }),
      ).resolves.toBe(true);
      await expect(
        repository.assignMemberDepartment({
          organizationId: ACME,
          userId: "nobody",
          departmentId: null,
        }),
      ).resolves.toBe(false);

      expect(
        await repository.findMemberDepartments({ organizationId: OTHER, userIds: ["maria"] }),
      ).toEqual([{ userId: "maria", departmentId: "dept_elsewhere" }]);
      expect(
        await repository.findMemberDepartments({ organizationId: ACME, userIds: ["maria"] }),
      ).toEqual([{ userId: "maria", departmentId: "dept_eng" }]);
    });
  });

  describe("when a team is pointed at a department", () => {
    it("moves only that organization's team and lists teams by name", async () => {
      const { memory, repository } = harness();
      const team = (id: string, name: string, organizationId: string) =>
        memory.teams.set(id, {
          id,
          name,
          slug: id,
          organizationId,
          isPersonal: false,
          ownerUserId: null,
          archivedAt: null,
          createdAt: EPOCH,
          updatedAt: EPOCH,
        });
      team("team_web", "Web", ACME);
      team("team_api", "Api", ACME);
      team("team_far", "Far", OTHER);

      await expect(
        repository.assignTeamDepartment({
          organizationId: ACME,
          teamId: "team_web",
          departmentId: "dept_eng",
        }),
      ).resolves.toBe(true);
      await expect(
        repository.assignTeamDepartment({
          organizationId: ACME,
          teamId: "team_far",
          departmentId: "dept_eng",
        }),
      ).resolves.toBe(false);
      expect(await repository.findTeamsWithDepartments({ organizationId: ACME })).toEqual([
        { id: "team_api", name: "Api", departmentId: null },
        { id: "team_web", name: "Web", departmentId: "dept_eng" },
      ]);
    });
  });
});
