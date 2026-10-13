/**
 * @vitest-environment node
 * The memory twins apply the Developer seat (ADR-171) as the prisma repositories do.
 */
import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryGroupRepository } from "../memory/memory.group.repository.ts";
import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ACME = "org_acme";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function seeded() {
  const memory = MemoryOrganizationDatabase.create();
  const seats = [
    ["ada", OrganizationUserRole.ADMIN],
    ["mia", OrganizationUserRole.MEMBER],
    ["dev", OrganizationUserRole.DEVELOPER],
  ] as const;
  for (const [userId, role] of seats) {
    memory.organizationUsers.push({
      userId,
      organizationId: ACME,
      role,
      disabledAt: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  }
  for (const [id, isPersonal] of [
    ["team_shared", false],
    ["team_mia_personal", true],
  ] as const) {
    memory.teams.set(id, {
      id,
      name: id,
      slug: id,
      organizationId: ACME,
      isPersonal,
      ownerUserId: isPersonal ? "mia" : null,
      archivedAt: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
    memory.teamUsers.push({
      teamId: id,
      userId: "mia",
      role: TeamUserRole.MEMBER,
      customRoleId: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  }
  memory.groups.set("group_admins", {
    id: "group_admins",
    organizationId: ACME,
    name: "Admins",
    slug: "admins",
    externalId: null,
    scimSource: null,
    memberIds: new Set(["mia", "dev"]),
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
  return memory;
}

describe("the memory twins on a Developer seat", () => {
  it("leaves a Developer out of a group's expanded members", async () => {
    const groups = MemoryGroupRepository.create({ memory: seeded() });

    const members = await groups.findMembersForGroups({
      groupIds: ["group_admins"],
      organizationId: ACME,
    });

    expect(members.get("group_admins")?.map((member) => member.userId)).toEqual(["mia"]);
  });

  it("drops every shared team row and keeps the personal team on a move to Developer", async () => {
    const memory = seeded();
    const repository = MemoryOrganizationMembershipRepository.create({ memory });

    await repository.updateMemberRole({
      caller: { type: "system" },
      currentUserId: null,
      organizationId: ACME,
      userId: "mia",
      role: OrganizationUserRole.DEVELOPER,
      effectiveTeamRoleUpdates: [],
    });

    expect(memory.teamUsers.filter((row) => row.userId === "mia").map((row) => row.teamId)).toEqual(
      ["team_mia_personal"],
    );
  });
});
