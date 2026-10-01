/**
 * @vitest-environment node
 * @see modules/organization/specs/team-visibility.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi, AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { OrganizationVisibilityService } from "../organization-visibility.service.ts";

const CALLER = { id: "user-1" };
const T0 = Temporal.Instant.fromEpochMilliseconds(0);

/** One organization with two teams of one project each; the caller belongs to `own-team` only. */
function seededMembership({
  organizationRole,
  ownTeamRow,
}: {
  organizationRole: "ADMIN" | "MEMBER";
  ownTeamRow: boolean;
}): MemoryOrganizationMembershipRepository {
  const memory = MemoryOrganizationDatabase.create();
  memory.organizations.set("org-1", {
    id: "org-1",
    name: "Narrowing Org",
    slug: "narrowing-org",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.organizationUsers.push({
    userId: CALLER.id,
    organizationId: "org-1",
    role: organizationRole,
    disabledAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
  for (const teamId of ["own-team", "other-team"]) {
    memory.teams.set(teamId, {
      id: teamId,
      name: teamId,
      slug: teamId,
      organizationId: "org-1",
      isPersonal: false,
      ownerUserId: null,
      archivedAt: null,
      createdAt: T0,
      updatedAt: T0,
    });
    memory.projects.set(`${teamId}-project`, {
      id: `${teamId}-project`,
      name: `${teamId} project`,
      slug: `${teamId}-project`,
      apiKey: "",
      lwqlKey: "",
      teamId,
      isPersonal: false,
      ownerUserId: null,
      organizationId: "org-1",
      archivedAt: null,
      createdAt: T0,
      personalFeatures: null,
    });
  }
  if (ownTeamRow) {
    memory.teamUsers.push({
      teamId: "own-team",
      userId: CALLER.id,
      role: "MEMBER",
      customRoleId: null,
      createdAt: T0,
      updatedAt: T0,
    });
  }
  return MemoryOrganizationMembershipRepository.create({ memory });
}

function binding({
  organizationId,
  scopeType,
  scopeId,
  role,
}: Pick<
  AuthzBindingForSynthesis,
  "organizationId" | "scopeType" | "scopeId" | "role"
>): AuthzBindingForSynthesis {
  return { organizationId, scopeType, scopeId, role, customRoleId: null, customRole: null };
}

/** The team ids the caller receives for the only organization. */
async function teamsReceived({
  organizationRole,
  ownTeamRow = true,
  bindings = [],
}: {
  organizationRole: "ADMIN" | "MEMBER";
  ownTeamRow?: boolean;
  bindings?: AuthzBindingForSynthesis[];
}) {
  const membership = seededMembership({ organizationRole, ownTeamRow });
  const service = OrganizationVisibilityService.create({
    reader: {
      getAllForUser: (input) => membership.findAllForUser(input),
      findOrganizationWithMembers: (input) => membership.findOrganizationWithMembers(input),
      findMemberById: (input) => membership.findMemberById(input),
    },
    permissions: createApiFixture<AuthzApi>({
      hasPermission: vi.fn(async () => false),
      canBatchByIds: vi.fn(async () => ({
        teams: new Map<string, boolean>(),
        projects: new Map<string, boolean>(),
        organizationRole: null,
      })),
      listBindingsForSynthesis: vi.fn(async () => bindings),
    }),
    secrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    demoProject: { userId: "", projectId: "" },
  });
  const [organization] = await service.listVisible({ isDemo: false }, CALLER);
  if (!organization) throw new Error("the caller's organization did not arrive");

  return organization.teams.map((team) => ({
    id: team.id,
    projects: team.projects.map((project) => project.id),
  }));
}

describe("given an organization with two teams, one of them the caller's", () => {
  describe("when an organization administrator lists their organizations", () => {
    /** @scenario "An organization administrator receives every team" */
    it("returns both teams with their projects", async () => {
      const teams = await teamsReceived({ organizationRole: "ADMIN" });

      expect(teams).toEqual([
        { id: "own-team", projects: ["own-team-project"] },
        { id: "other-team", projects: ["other-team-project"] },
      ]);
    });
  });

  describe("when an organization member lists their organizations", () => {
    /** @scenario "An organization member receives only the teams they belong to" */
    it("returns only the team they belong to", async () => {
      const teams = await teamsReceived({ organizationRole: "MEMBER" });

      expect(teams).toEqual([{ id: "own-team", projects: ["own-team-project"] }]);
    });
  });

  describe("when a team binding reaches a team without a membership row", () => {
    /** @scenario "A team reached through a binding arrives without a membership row" */
    it("returns that team with its projects", async () => {
      const teams = await teamsReceived({
        organizationRole: "MEMBER",
        ownTeamRow: false,
        bindings: [
          binding({
            organizationId: "org-1",
            scopeType: "TEAM",
            scopeId: "other-team",
            role: "VIEWER",
          }),
        ],
      });

      expect(teams).toEqual([{ id: "other-team", projects: ["other-team-project"] }]);
    });
  });

  describe("when an administrator binding names a caller whose row says member", () => {
    /** @scenario "An administrator binding outranks a stale member row" */
    it("returns every team", async () => {
      const teams = await teamsReceived({
        organizationRole: "MEMBER",
        bindings: [
          binding({
            organizationId: "org-1",
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
            role: "ADMIN",
          }),
        ],
      });

      expect(teams.map((team) => team.id)).toEqual(["own-team", "other-team"]);
    });
  });

  describe("when a member belongs to none of the teams", () => {
    /** @scenario "A member of no team receives the organization without teams" */
    it("returns the organization with no teams", async () => {
      const teams = await teamsReceived({ organizationRole: "MEMBER", ownTeamRow: false });

      expect(teams).toEqual([]);
    });
  });

  describe("when the caller's only binding names a team in another organization", () => {
    /** @scenario "A binding in another organization opens nothing here" */
    it("returns no team of this organization", async () => {
      const teams = await teamsReceived({
        organizationRole: "MEMBER",
        ownTeamRow: false,
        bindings: [
          binding({
            organizationId: "org-2",
            scopeType: "TEAM",
            scopeId: "other-team",
            role: "ADMIN",
          }),
        ],
      });

      expect(teams).toEqual([]);
    });
  });
});
