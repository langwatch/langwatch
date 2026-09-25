import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzAccessBinding, AuthzApi, TeamUserRole } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { MemoryGroupRepository } from "../../repositories/memory/memory.group.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryTeamRepository } from "../../repositories/memory/memory.team.repository.ts";
import { OrganizationTeamAccessService } from "../organization-team-access.service.ts";

const organizationId = "org_1";
const createdAt = new Date("2026-01-01T00:00:00Z");

function binding(input: {
  id: string;
  scopeType: "TEAM" | "PROJECT";
  scopeId: string;
  role: TeamUserRole;
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
}): AuthzAccessBinding {
  return {
    id: input.id,
    organizationId,
    userId: input.userId ?? null,
    groupId: input.groupId ?? null,
    apiKeyId: input.apiKeyId ?? null,
    role: input.role,
    customRoleId: null,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    createdAt,
    user: input.userId
      ? {
          id: input.userId,
          name: `Name ${input.userId}`,
          email: `${input.userId}@x.io`,
          image: null,
        }
      : null,
    group: input.groupId
      ? { id: input.groupId, name: `Group ${input.groupId}`, scimSource: null }
      : null,
    apiKey: input.apiKeyId ? { id: input.apiKeyId, name: `Key ${input.apiKeyId}` } : null,
    customRole: null,
  };
}

const teamBindings = [
  binding({ id: "tb_u1", scopeType: "TEAM", scopeId: "team_1", role: "ADMIN", userId: "u1" }),
  binding({ id: "tb_g1", scopeType: "TEAM", scopeId: "team_1", role: "MEMBER", groupId: "g1" }),
];
const projectBindings = [
  binding({ id: "pb_u2", scopeType: "PROJECT", scopeId: "p1", role: "VIEWER", userId: "u2" }),
  binding({ id: "pb_u1", scopeType: "PROJECT", scopeId: "p1", role: "VIEWER", userId: "u1" }),
  binding({ id: "pb_u4", scopeType: "PROJECT", scopeId: "p1", role: "ADMIN", userId: "u4" }),
  binding({ id: "pb_g2", scopeType: "PROJECT", scopeId: "p1", role: "MEMBER", groupId: "g2" }),
  binding({ id: "pb_g1", scopeType: "PROJECT", scopeId: "p2", role: "VIEWER", groupId: "g1" }),
  binding({ id: "pb_k1", scopeType: "PROJECT", scopeId: "p2", role: "MEMBER", apiKeyId: "k1" }),
];

async function listTeamAccess() {
  const memory = MemoryOrganizationDatabase.create();
  const teams = MemoryTeamRepository.create({ memory });
  const groups = MemoryGroupRepository.create({ memory });
  await teams.create({ teamId: "team_1", name: "Team", slug: "team", organizationId });
  await groups.create({
    groupId: "g1",
    organizationId,
    name: "G1",
    slug: "g1",
    memberIds: ["u2", "u3"],
  });
  await groups.create({
    groupId: "g2",
    organizationId,
    name: "G2",
    slug: "g2",
    memberIds: ["u3", "u5"],
  });
  const authz = createApiFixture<AuthzApi>({
    listScopeBindings: async ({ scopeType }) =>
      scopeType === "TEAM" ? teamBindings : projectBindings,
  });
  const service = OrganizationTeamAccessService.create({ authz, groups, teams });

  return service.listTeamAccess({
    organizationId,
    projects: [
      { id: "p1", name: "One", teamId: "team_1" },
      { id: "p2", name: "Two", teamId: "team_1" },
      { id: "p3", name: "Three", teamId: "team_1" },
    ],
  });
}

describe("OrganizationTeamAccessService", () => {
  describe("given team, group and project bindings", () => {
    describe("when the team access is listed", () => {
      it("splits each project's access into inherited, override and direct entries", async () => {
        const [team] = await listTeamAccess();

        expect(
          Object.fromEntries(
            Object.entries(team?.projectAccess ?? {}).map(([projectId, entries]) => [
              projectId,
              entries.map((entry) => ({
                bindingId: entry.bindingId,
                userId: entry.userId,
                groupId: entry.groupId,
                viaGroupName: entry.viaGroupName,
                name: entry.name,
                role: entry.role,
                source: entry.source,
                teamRole: "teamRole" in entry ? entry.teamRole : undefined,
              })),
            ]),
          ),
        ).toMatchInlineSnapshot(`
          {
            "p1": [
              {
                "bindingId": "pb_u2",
                "groupId": null,
                "name": "Name u2",
                "role": "VIEWER",
                "source": "override",
                "teamRole": undefined,
                "userId": "u2",
                "viaGroupName": null,
              },
              {
                "bindingId": "pb_u1",
                "groupId": null,
                "name": "Name u1",
                "role": "VIEWER",
                "source": "override",
                "teamRole": "ADMIN",
                "userId": "u1",
                "viaGroupName": null,
              },
              {
                "bindingId": "pb_u4",
                "groupId": null,
                "name": "Name u4",
                "role": "ADMIN",
                "source": "direct",
                "teamRole": undefined,
                "userId": "u4",
                "viaGroupName": null,
              },
              {
                "bindingId": "pb_g2",
                "groupId": "g2",
                "name": "Group g2",
                "role": "MEMBER",
                "source": "direct",
                "teamRole": undefined,
                "userId": null,
                "viaGroupName": "Group g2",
              },
            ],
            "p2": [
              {
                "bindingId": "tb_u1",
                "groupId": null,
                "name": "Name u1",
                "role": "ADMIN",
                "source": "team",
                "teamRole": undefined,
                "userId": "u1",
                "viaGroupName": null,
              },
              {
                "bindingId": "pb_g1",
                "groupId": "g1",
                "name": "Group g1",
                "role": "VIEWER",
                "source": "override",
                "teamRole": undefined,
                "userId": null,
                "viaGroupName": "Group g1",
              },
              {
                "bindingId": "pb_k1",
                "groupId": null,
                "name": "Key k1",
                "role": "MEMBER",
                "source": "direct",
                "teamRole": undefined,
                "userId": null,
                "viaGroupName": null,
              },
            ],
            "p3": [
              {
                "bindingId": "tb_u1",
                "groupId": null,
                "name": "Name u1",
                "role": "ADMIN",
                "source": "team",
                "teamRole": undefined,
                "userId": "u1",
                "viaGroupName": null,
              },
              {
                "bindingId": null,
                "groupId": "g1",
                "name": "Unknown",
                "role": "MEMBER",
                "source": "team",
                "teamRole": undefined,
                "userId": "u2",
                "viaGroupName": "Group g1",
              },
              {
                "bindingId": null,
                "groupId": "g1",
                "name": "Unknown",
                "role": "MEMBER",
                "source": "team",
                "teamRole": undefined,
                "userId": "u3",
                "viaGroupName": "Group g1",
              },
            ],
          }
        `);
      });

      it("lists people who reach a project without the team", async () => {
        const [team] = await listTeamAccess();

        expect(
          team?.projectOnlyAccess.map(({ userId, projectId }) => ({ userId, projectId })),
        ).toEqual([{ userId: "u4", projectId: "p1" }]);
      });
    });
  });
});
