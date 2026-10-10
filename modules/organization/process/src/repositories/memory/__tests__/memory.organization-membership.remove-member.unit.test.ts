import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";

const at = Temporal.Instant.from("2026-10-10T00:00:00Z");

function group({ id, organizationId }: { id: string; organizationId: string }) {
  return {
    id,
    organizationId,
    name: id,
    slug: id,
    externalId: null,
    scimSource: null,
    memberIds: new Set(["user_sam"]),
    createdAt: at,
    updatedAt: at,
  };
}

function seeded() {
  const memory = MemoryOrganizationDatabase.create();
  for (const organizationId of ["org_1", "org_2"]) {
    memory.organizationUsers.push({
      userId: "user_sam",
      organizationId,
      role: "MEMBER",
      disabledAt: null,
      createdAt: at,
      updatedAt: at,
    });
    memory.teams.set(`team_${organizationId}`, {
      id: `team_${organizationId}`,
      name: "Team",
      slug: `team-${organizationId}`,
      organizationId,
      isPersonal: false,
      ownerUserId: null,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
    });
    memory.teamUsers.push({
      teamId: `team_${organizationId}`,
      userId: "user_sam",
      role: "MEMBER",
      customRoleId: null,
      createdAt: at,
      updatedAt: at,
    });
    memory.groups.set(
      `group_${organizationId}`,
      group({ id: `group_${organizationId}`, organizationId }),
    );
  }
  return { memory, repository: MemoryOrganizationMembershipRepository.create({ memory }) };
}

describe("MemoryOrganizationMembershipRepository.deleteMember", () => {
  describe("given a member of groups and teams in two organizations", () => {
    /** @scenario Removing a member drops their group and team memberships in that organization only */
    it("drops the memberships in the organization they leave and keeps the other's", async () => {
      const { memory, repository } = seeded();

      await repository.deleteMember({
        organizationId: "org_1",
        userId: "user_sam",
        actingUserId: "user_admin",
      });

      expect(memory.groups.get("group_org_1")?.memberIds.has("user_sam")).toBe(false);
      expect(memory.groups.get("group_org_2")?.memberIds.has("user_sam")).toBe(true);
      expect(memory.teamUsers.map((row) => row.teamId)).toEqual(["team_org_2"]);
    });
  });
});
