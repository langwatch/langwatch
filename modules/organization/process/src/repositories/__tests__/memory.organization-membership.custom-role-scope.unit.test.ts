/**
 * @vitest-environment node
 * The memory twin refuses a custom role from another organization, as the prisma repository does.
 */
import { NotFoundError } from "@langwatch/handled-error";
import {
  CustomRoleNotAssignableError,
  OrganizationUserRole,
  TeamUserRole,
} from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ACME = "org_acme";
const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

function harness() {
  const memory = MemoryOrganizationDatabase.create();
  for (const userId of ["ada", "grace"]) {
    memory.organizationUsers.push({
      userId,
      organizationId: ACME,
      role: OrganizationUserRole.ADMIN,
      disabledAt: null,
      createdAt: EPOCH,
      updatedAt: EPOCH,
    });
  }
  memory.teams.set("team_acme", {
    id: "team_acme",
    name: "Acme",
    slug: "acme",
    organizationId: ACME,
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
  memory.teamUsers.push({
    teamId: "team_acme",
    userId: "ada",
    role: TeamUserRole.MEMBER,
    customRoleId: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
  memory.customRoles.set("role_ours", {
    id: "role_ours",
    organizationId: ACME,
    name: "Auditor",
    kind: "custom",
    permissions: [],
  });
  memory.customRoles.set("role_theirs", {
    id: "role_theirs",
    organizationId: "org_elsewhere",
    name: "Auditor",
    kind: "custom",
    permissions: [],
  });
  const repository = MemoryOrganizationMembershipRepository.create({ memory });
  const teamUser = () => memory.teamUsers.find((row) => row.userId === "ada");
  return { memory, repository, teamUser };
}

describe("assigning a custom team role in the memory twin", () => {
  it("refuses another organization's role on a team role change and keeps the old role", async () => {
    const { repository, teamUser } = harness();

    await expect(
      repository.updateTeamMemberRole({
        teamId: "team_acme",
        userId: "ada",
        role: TeamUserRole.MEMBER,
        customRoleId: "role_theirs",
        currentUserId: "grace",
        caller: { type: "system" },
      }),
    ).rejects.toBeInstanceOf(CustomRoleNotAssignableError);
    expect(teamUser()?.customRoleId).toBeNull();
  });

  it("assigns this organization's role on a team role change", async () => {
    const { repository, teamUser } = harness();

    await repository.updateTeamMemberRole({
      teamId: "team_acme",
      userId: "ada",
      role: TeamUserRole.MEMBER,
      customRoleId: "role_ours",
      currentUserId: "grace",
      caller: { type: "system" },
    });

    expect(teamUser()?.customRoleId).toBe("role_ours");
  });

  it("refuses another organization's role on a seat change before writing anything", async () => {
    const { memory, repository, teamUser } = harness();

    await expect(
      repository.updateMemberRole({
        organizationId: ACME,
        userId: "ada",
        role: OrganizationUserRole.MEMBER,
        effectiveTeamRoleUpdates: [
          {
            teamId: "team_acme",
            role: "custom:auditor",
            customRoleId: "role_theirs",
            origin: "requested",
          },
        ],
        currentUserId: "grace",
        caller: { type: "system" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(teamUser()?.customRoleId).toBeNull();
    expect(memory.organizationUsers.find((row) => row.userId === "ada")?.role).toBe(
      OrganizationUserRole.ADMIN,
    );
  });
});
