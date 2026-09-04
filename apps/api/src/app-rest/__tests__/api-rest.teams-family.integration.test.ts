/**
 * The teams management family (`/api/teams`), mounted the way this process
 * mounts it and driven through this process's OWN security spine.
 *
 * Ported from `platform/app/src/app/api/teams/__tests__/teams-rest-api.integration.test.ts`
 * on origin/main, which drove the retired platform router against Postgres.
 * Two things are real here that a hand-rolled spine would have faked away:
 * `ApiRestSecurity` resolves the credential, decides 401 from 403 and runs the
 * per-team RBAC check, and `ApiRestObservabilityComposition` renders every
 * refusal, so a code is asserted at the wire a customer reads. What is in
 * memory is the directory the routes would have read from Postgres.
 *
 * @see specs/teams/teams-rest-api.feature
 */
import { type ApiKeyService } from "@langwatch/api-key-contract";
import type { AuthzAccessBinding, AuthzService } from "@langwatch/authz-contract";
import {
  PERSONAL_TEAM_ARCHIVE_REFUSAL,
  PERSONAL_TEAM_MEMBERSHIP_REFUSAL,
  PersonalTeamProtectedError,
  TeamMemberAlreadyAddedError,
  TeamMembershipNotFoundError,
  TeamNotFoundError,
  UserNotInOrganizationError,
  type OrganizationService,
  type OrganizationSettings,
  type OrganizationTeam,
  type OrganizationTeamPage,
} from "@langwatch/organization-contract";
import { TeamIdentityAdapter } from "@langwatch/organization-server";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { ApiRestObservabilityComposition } from "../../app/api-rest-observability.composition";
import { ApiRestSecurity } from "../../api-rest.security";
import {
  errorCodeOf,
  mountRestFamily,
  TEST_ORGANIZATION_ID,
  type MountedRestFamily,
} from "./support/rest-family.harness";

const OTHER_ORGANIZATION_ID = "organization-2";

const ADMIN_TOKEN = "org-admin-token";
const VIEWER_TOKEN = "org-viewer-token";
const ADMIN_KEY_ID = "apikey-admin";
const VIEWER_KEY_ID = "apikey-viewer";

const OWNER_USER_ID = "user-owner";
const COLLEAGUE_USER_ID = "user-colleague";
const OUTSIDER_USER_ID = "user-outsider";

const PERSONAL_TEAM_ID = "team_personal";
const OTHER_ORGANIZATION_TEAM_ID = "team_elsewhere";

const asAdmin = { authorization: `Bearer ${ADMIN_TOKEN}` };
const asViewer = { authorization: `Bearer ${VIEWER_TOKEN}` };

describe("given the organization's teams over REST", () => {
  describe("when a request carries no usable organization credential", () => {
    // @scenario "Rejects unauthenticated requests"
    it("refuses a listing sent with no authorization header", async () => {
      const { api } = mountTeams();

      const response = await api.get("/api/v1/teams");

      expect(response.status).toBe(401);
    });

    // @scenario "Rejects invalid API key"
    it("refuses a listing sent with a bearer token that resolves to nothing", async () => {
      const { api } = mountTeams();

      const response = await api.get("/api/v1/teams", {
        authorization: "Bearer sk-lw-invalid_token",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("when a team is created", () => {
    // @scenario "Creates a team"
    it("answers 201 with the team's id, name, slug, organization and timestamps", async () => {
      const { api } = mountTeams();

      const response = await api.post("/api/v1/teams", { name: "My Test Team" }, asAdmin);

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.id).toMatch(/^team_/);
      expect(body.name).toBe("My Test Team");
      expect(body.slug).toContain("my-test-team");
      expect(body.organizationId).toBe(TEST_ORGANIZATION_ID);
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    // @scenario "Rejects create when name is missing"
    it("refuses a body with no name at all", async () => {
      const { api } = mountTeams();

      const response = await api.post("/api/v1/teams", {}, asAdmin);

      expect(response.status).toBe(422);
      await expect(errorCodeOf(response)).resolves.toBe("validation_error");
    });

    // @scenario "Rejects create when name is empty"
    it("refuses an empty name", async () => {
      const { api } = mountTeams();

      const response = await api.post("/api/v1/teams", { name: "" }, asAdmin);

      expect(response.status).toBe(422);
    });

    // @scenario "Rejects create when name exceeds 255 characters"
    it("refuses a name longer than 255 characters", async () => {
      const { api } = mountTeams();

      const response = await api.post("/api/v1/teams", { name: "a".repeat(256) }, asAdmin);

      expect(response.status).toBe(422);
    });
  });

  describe("when teams are listed", () => {
    // @scenario "Lists non-archived teams for the organization"
    it("answers a paginated data array", async () => {
      const { api } = mountTeams();
      await api.post("/api/v1/teams", { name: "Listed" }, asAdmin);

      const response = await api.get("/api/v1/teams", asAdmin);

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { name: string }[];
        pagination: { page: number; limit: number; total: number };
      };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.map(({ name }) => name)).toContain("Listed");
      expect(body.pagination.page).toBe(1);
    });

    // @scenario "Paginates team list"
    it("honours the page and limit the caller asked for", async () => {
      const { api } = mountTeams();
      for (const name of ["One", "Two", "Three"]) {
        await api.post("/api/v1/teams", { name }, asAdmin);
      }

      const response = await api.get("/api/v1/teams?page=1&limit=2", asAdmin);

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: unknown[];
        pagination: { limit: number; total: number };
      };
      expect(body.pagination.limit).toBe(2);
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(4);
    });

    // @scenario "Excludes teams from other organizations"
    it("answers only teams belonging to the credential's organization", async () => {
      const { api } = mountTeams();

      const response = await api.get("/api/v1/teams", asAdmin);

      const body = (await response.json()) as { data: { id: string; organizationId: string }[] };
      expect(body.data.length).toBeGreaterThan(0);
      for (const team of body.data) {
        expect(team.organizationId).toBe(TEST_ORGANIZATION_ID);
      }
      expect(body.data.map(({ id }) => id)).not.toContain(OTHER_ORGANIZATION_TEAM_ID);
    });
  });

  describe("when one team is read by id", () => {
    // @scenario "Returns a team by id"
    it("answers the team the create returned", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Read Me" }, asAdmin)
      ).json()) as { id: string; name: string };

      const response = await api.get(`/api/v1/teams/${created.id}`, asAdmin);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; name: string };
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(created.name);
    });

    // @scenario "Returns 404 for non-existent team"
    it("refuses an id no team carries", async () => {
      const { api } = mountTeams();

      const response = await api.get("/api/v1/teams/team_doesnotexist", asAdmin);

      expect(response.status).toBe(404);
    });

    // @scenario "Returns 404 for team in another organization"
    it("refuses a team that belongs to a different organization", async () => {
      const { api } = mountTeams();

      const response = await api.get(`/api/v1/teams/${OTHER_ORGANIZATION_TEAM_ID}`, asAdmin);

      expect(response.status).toBe(404);
    });
  });

  describe("when a team is renamed", () => {
    // @scenario "Updates team name"
    it("answers the team under its new name", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Before" }, asAdmin)
      ).json()) as { id: string };

      const response = await api.patch(
        `/api/v1/teams/${created.id}`,
        { name: "Updated Name" },
        asAdmin,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; name: string };
      expect(body.id).toBe(created.id);
      expect(body.name).toBe("Updated Name");
    });

    // @scenario "Returns 404 when updating non-existent team"
    it("refuses a rename of a team that does not exist", async () => {
      const { api } = mountTeams();

      const response = await api.patch("/api/v1/teams/team_ghost", { name: "Whatever" }, asAdmin);

      expect(response.status).toBe(404);
    });
  });

  describe("when a team is archived", () => {
    // @scenario "Archives a team"
    it("answers the archived team with the moment it was archived", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Archive Me" }, asAdmin)
      ).json()) as { id: string };

      const response = await api.delete(`/api/v1/teams/${created.id}`, asAdmin);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { id: string; archivedAt: string | null };
      expect(body.id).toBe(created.id);
      expect(body.archivedAt).toBeTruthy();
    });

    // @scenario "Archived team is inaccessible via GET"
    it("refuses a read of the team afterwards", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Gone" }, asAdmin)
      ).json()) as { id: string };
      await api.delete(`/api/v1/teams/${created.id}`, asAdmin);

      const response = await api.get(`/api/v1/teams/${created.id}`, asAdmin);

      expect(response.status).toBe(404);
    });

    // @scenario "Archived team is excluded from list"
    it("leaves the team out of the listing afterwards", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Unlisted" }, asAdmin)
      ).json()) as { id: string };
      await api.delete(`/api/v1/teams/${created.id}`, asAdmin);

      const response = await api.get("/api/v1/teams", asAdmin);

      const body = (await response.json()) as { data: { id: string }[] };
      expect(body.data.map(({ id }) => id)).not.toContain(created.id);
    });

    // @scenario "Returns 404 when deleting non-existent team"
    it("refuses an archive of a team that does not exist", async () => {
      const { api } = mountTeams();

      const response = await api.delete("/api/v1/teams/team_nope", asAdmin);

      expect(response.status).toBe(404);
    });

    // @scenario "Returns 404 when deleting already-archived team"
    it("refuses a second archive of the same team", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Twice" }, asAdmin)
      ).json()) as { id: string };
      await api.delete(`/api/v1/teams/${created.id}`, asAdmin);

      const response = await api.delete(`/api/v1/teams/${created.id}`, asAdmin);

      expect(response.status).toBe(404);
    });
  });

  describe("when the team is somebody's personal workspace", () => {
    // @scenario "Refuses to archive a personal team"
    it("names personal_workspace_not_managed_here and leaves the workspace unarchived", async () => {
      const { api } = mountTeams();

      const response = await api.delete(`/api/v1/teams/${PERSONAL_TEAM_ID}`, asAdmin);

      expect(response.status).toBe(403);
      await expect(errorCodeOf(response)).resolves.toBe("personal_workspace_not_managed_here");
      expect((await api.get(`/api/v1/teams/${PERSONAL_TEAM_ID}`, asAdmin)).status).toBe(200);
    });

    // @scenario "Refuses to add a member to a personal team"
    it("names personal_workspace_not_managed_here and leaves the owner alone on it", async () => {
      const { api } = mountTeams();

      const response = await api.post(
        `/api/v1/teams/${PERSONAL_TEAM_ID}/members`,
        { userId: COLLEAGUE_USER_ID, role: "MEMBER" },
        asAdmin,
      );

      expect(response.status).toBe(403);
      await expect(errorCodeOf(response)).resolves.toBe("personal_workspace_not_managed_here");
      await expect(memberUserIds(api, PERSONAL_TEAM_ID)).resolves.toEqual([OWNER_USER_ID]);
    });

    // @scenario "Refuses to remove a member from a personal team"
    it("names personal_workspace_not_managed_here and leaves the owner's binding in place", async () => {
      const { api } = mountTeams();

      const response = await api.delete(
        `/api/v1/teams/${PERSONAL_TEAM_ID}/members/${OWNER_USER_ID}`,
        asAdmin,
      );

      expect(response.status).toBe(403);
      await expect(errorCodeOf(response)).resolves.toBe("personal_workspace_not_managed_here");
      await expect(memberUserIds(api, PERSONAL_TEAM_ID)).resolves.toEqual([OWNER_USER_ID]);
    });
  });

  describe("when a member holds more than one role on the same team", () => {
    // @scenario "Removing a member takes every role they hold on the team"
    it("takes every role they hold there rather than the first one found", async () => {
      const { api } = mountTeams();
      const team = (await (
        await api.post("/api/v1/teams", { name: "Multi Role" }, asAdmin)
      ).json()) as { id: string };
      const addMember = (role: string, userId: string) =>
        api.post(`/api/v1/teams/${team.id}/members`, { userId, role }, asAdmin);

      expect((await addMember("ADMIN", OWNER_USER_ID)).status).toBe(201);
      expect((await addMember("MEMBER", COLLEAGUE_USER_ID)).status).toBe(201);
      expect((await addMember("VIEWER", COLLEAGUE_USER_ID)).status).toBe(201);

      const response = await api.delete(
        `/api/v1/teams/${team.id}/members/${COLLEAGUE_USER_ID}`,
        asAdmin,
      );

      expect(response.status).toBe(200);
      await expect(memberUserIds(api, team.id)).resolves.toEqual([OWNER_USER_ID]);
    });
  });

  describe("when a management call is refused", () => {
    // @scenario "An unknown team names the code"
    it("names team_not_found for a team that does not exist", async () => {
      const { api } = mountTeams();

      const response = await api.get("/api/v1/teams/team_does_not_exist", asAdmin);

      expect(response.status).toBe(404);
      await expect(errorCodeOf(response)).resolves.toBe("team_not_found");
    });

    // @scenario "Adding somebody who is not in the organization names the code"
    it("names user_not_in_organization for somebody outside the organization", async () => {
      const { api } = mountTeams();
      const team = (await (
        await api.post("/api/v1/teams", { name: "Outsiders" }, asAdmin)
      ).json()) as { id: string };

      const response = await api.post(
        `/api/v1/teams/${team.id}/members`,
        { userId: OUTSIDER_USER_ID, role: "MEMBER" },
        asAdmin,
      );

      expect(response.status).toBe(422);
      await expect(errorCodeOf(response)).resolves.toBe("user_not_in_organization");
    });

    // @scenario "Granting a role a member already holds names the code"
    it("names team_member_already_added for a role they already hold", async () => {
      const { api } = mountTeams();
      const team = (await (
        await api.post("/api/v1/teams", { name: "Duplicates" }, asAdmin)
      ).json()) as { id: string };
      const grant = () =>
        api.post(
          `/api/v1/teams/${team.id}/members`,
          { userId: COLLEAGUE_USER_ID, role: "MEMBER" },
          asAdmin,
        );
      expect((await grant()).status).toBe(201);

      const response = await grant();

      expect(response.status).toBe(409);
      await expect(errorCodeOf(response)).resolves.toBe("team_member_already_added");
    });

    // @scenario "Removing somebody who holds no role on the team names the code"
    it("names team_membership_not_found for somebody who is not on the team", async () => {
      const { api } = mountTeams();
      const team = (await (
        await api.post("/api/v1/teams", { name: "Empty" }, asAdmin)
      ).json()) as { id: string };

      const response = await api.delete(
        `/api/v1/teams/${team.id}/members/${COLLEAGUE_USER_ID}`,
        asAdmin,
      );

      expect(response.status).toBe(404);
      await expect(errorCodeOf(response)).resolves.toBe("team_membership_not_found");
    });
  });

  describe("when the credential holds no team permission", () => {
    // @scenario "Viewer cannot list teams"
    it("refuses the listing", async () => {
      const { api } = mountTeams();

      expect((await api.get("/api/v1/teams", asViewer)).status).toBe(403);
    });

    // @scenario "Viewer cannot create a team"
    it("refuses the create", async () => {
      const { api } = mountTeams();

      expect((await api.post("/api/v1/teams", { name: "Blocked Team" }, asViewer)).status).toBe(
        403,
      );
    });

    // @scenario "Viewer cannot update a team"
    it("refuses the rename", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Guarded" }, asAdmin)
      ).json()) as { id: string };

      const response = await api.patch(`/api/v1/teams/${created.id}`, { name: "Nope" }, asViewer);

      expect(response.status).toBe(403);
    });

    // @scenario "Viewer cannot delete a team"
    it("refuses the archive", async () => {
      const { api } = mountTeams();
      const created = (await (
        await api.post("/api/v1/teams", { name: "Guarded Too" }, asAdmin)
      ).json()) as { id: string };

      const response = await api.delete(`/api/v1/teams/${created.id}`, asViewer);

      expect(response.status).toBe(403);
    });
  });

  describe("when the family is addressed without its version segment", () => {
    it("answers the bare alias identically to the dated path", async () => {
      const { api } = mountTeams();
      await api.post("/api/v1/teams", { name: "Both Doors" }, asAdmin);

      const dated = await api.get("/api/v1/teams", asAdmin);
      const bare = await api.get("/api/teams", asAdmin);

      expect(bare.status).toBe(dated.status);
      await expect(bare.json()).resolves.toEqual(await dated.json());
    });
  });
});

/** Who currently holds any role on one team, read back through the family. */
async function memberUserIds(api: MountedRestFamily, teamId: string): Promise<string[]> {
  const response = await api.get(`/api/v1/teams/${teamId}/members`, asAdmin);
  const body = (await response.json()) as { data: { userId: string }[] };
  return [...new Set(body.data.map(({ userId }) => userId))].sort();
}

type StoredBinding = {
  id: string;
  userId: string;
  role: string;
  teamId: string;
};

/**
 * The teams, their role bindings and the organization's roster, in memory.
 *
 * The refusals below are the ones `OrganizationService` raises for these
 * routes, spelled with the contract's own error classes so the code a customer
 * reads is the code the service publishes rather than one this suite invented.
 */
class TeamDirectory {
  readonly teams = new Map<string, OrganizationTeam>();
  readonly bindings: StoredBinding[] = [];
  readonly members = new Set([OWNER_USER_ID, COLLEAGUE_USER_ID]);
  private readonly identities = TeamIdentityAdapter.create();
  private sequence = 0;

  constructor() {
    this.seed({
      id: PERSONAL_TEAM_ID,
      name: "Owner's Workspace",
      slug: "personal-owner",
      organizationId: TEST_ORGANIZATION_ID,
      isPersonal: true,
      ownerUserId: OWNER_USER_ID,
    });
    this.bindings.push({
      id: "binding-owner",
      userId: OWNER_USER_ID,
      role: "ADMIN",
      teamId: PERSONAL_TEAM_ID,
    });
    this.seed({
      id: OTHER_ORGANIZATION_TEAM_ID,
      name: "Somebody Else's Team",
      slug: "somebody-else",
      organizationId: OTHER_ORGANIZATION_ID,
      isPersonal: false,
      ownerUserId: null,
    });
  }

  private seed(input: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    isPersonal: boolean;
    ownerUserId: string | null;
  }): void {
    this.teams.set(input.id, {
      ...input,
      archivedAt: null,
      createdAt: new Date(2026, 0, 1, 0, this.sequence++),
      updatedAt: new Date(2026, 0, 1, 0, 0),
    });
  }

  getTeam(input: { teamId: string; organizationId: string }): OrganizationTeam {
    const team = this.teams.get(input.teamId);
    if (!team || team.organizationId !== input.organizationId || team.archivedAt !== null) {
      throw new TeamNotFoundError(input.teamId);
    }
    return team;
  }

  listTeams(input: {
    organizationId: string;
    page: number;
    limit: number;
  }): OrganizationTeamPage {
    const rows = [...this.teams.values()]
      .filter(
        (team) => team.organizationId === input.organizationId && team.archivedAt === null,
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
    const from = (input.page - 1) * input.limit;
    return {
      data: rows.slice(from, from + input.limit),
      pagination: { page: input.page, limit: input.limit, total: rows.length },
    };
  }

  createTeam(input: { organizationId: string; name: string }): OrganizationTeam {
    const identity = this.identities.createTeam({ name: input.name });
    this.seed({
      id: identity.teamId,
      name: input.name,
      slug: identity.slug,
      organizationId: input.organizationId,
      isPersonal: false,
      ownerUserId: null,
    });
    return this.teams.get(identity.teamId) as OrganizationTeam;
  }

  updateTeam(input: {
    teamId: string;
    organizationId: string;
    name?: string;
  }): OrganizationTeam {
    const team = this.getTeam(input);
    const updated = {
      ...team,
      ...(input.name === undefined ? {} : { name: input.name }),
      updatedAt: new Date(2026, 0, 2),
    };
    this.teams.set(team.id, updated);
    return updated;
  }

  archiveTeam(input: { teamId: string; organizationId: string }): OrganizationTeam {
    const team = this.getTeam(input);
    if (team.isPersonal) throw new PersonalTeamProtectedError(PERSONAL_TEAM_ARCHIVE_REFUSAL);
    const archived = { ...team, archivedAt: new Date(2026, 0, 3) };
    this.teams.set(team.id, archived);
    return archived;
  }

  addTeamMember(input: {
    teamId: string;
    organizationId: string;
    userId: string;
    role: string;
  }): void {
    const team = this.getTeam(input);
    if (team.isPersonal) throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    if (!this.members.has(input.userId)) throw new UserNotInOrganizationError(input.userId);
    const held = this.bindings.some(
      (binding) =>
        binding.teamId === team.id &&
        binding.userId === input.userId &&
        binding.role === input.role,
    );
    if (held) throw new TeamMemberAlreadyAddedError(input.userId);
    this.bindings.push({
      id: `binding-${this.bindings.length + 1}`,
      userId: input.userId,
      role: input.role,
      teamId: team.id,
    });
  }

  removeTeamMember(input: { teamId: string; organizationId: string; userId: string }): void {
    const team = this.getTeam(input);
    if (team.isPersonal) throw new PersonalTeamProtectedError(PERSONAL_TEAM_MEMBERSHIP_REFUSAL);
    const held = this.bindings.filter(
      (binding) => binding.teamId === team.id && binding.userId === input.userId,
    );
    if (held.length === 0) throw new TeamMembershipNotFoundError(input.userId);
    for (const binding of held) {
      this.bindings.splice(this.bindings.indexOf(binding), 1);
    }
  }

  scopeBindings(input: { scopeIds: readonly string[] }): AuthzAccessBinding[] {
    return this.bindings
      .filter((binding) => input.scopeIds.includes(binding.teamId))
      .map((binding) => ({
        id: binding.id,
        organizationId: TEST_ORGANIZATION_ID,
        userId: binding.userId,
        groupId: null,
        apiKeyId: null,
        role: binding.role,
        customRoleId: null,
        scopeType: "TEAM",
        scopeId: binding.teamId,
        createdAt: new Date(2026, 0, 1),
        user: {
          id: binding.userId,
          name: binding.userId,
          email: `${binding.userId}@example.com`,
          image: null,
        },
        group: null,
        apiKey: null,
        customRole: null,
      })) as AuthzAccessBinding[];
  }
}

const ORGANIZATION_SETTINGS: OrganizationSettings = {
  id: TEST_ORGANIZATION_ID,
  name: "Acme",
  slug: "acme",
  supportContact: null,
  presenceEnabled: false,
  traceSharingEnabled: false,
  primaryIntent: null,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3Bucket: null,
  createdAt: new Date(2026, 0, 1),
  updatedAt: new Date(2026, 0, 1),
};

/**
 * Anything outside the team surface is a NAMED absence: an operation this
 * suite does not compose fails saying so rather than answering emptily.
 */
function namedAbsences<T extends object>(implemented: T, capability: string): never {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) return value;
      return () => {
        throw new Error(`This suite composes no ${capability} ${String(property)}`);
      };
    },
  }) as never;
}

function mountTeams(): { api: MountedRestFamily; directory: TeamDirectory } {
  const directory = new TeamDirectory();

  const organizations: OrganizationService = namedAbsences(
    {
      getSettings: async (input: { organizationId: string }) => {
        if (input.organizationId !== TEST_ORGANIZATION_ID) throw new Error("unknown organization");
        return ORGANIZATION_SETTINGS;
      },
      getTeam: async (input: { teamId: string; organizationId: string }) =>
        directory.getTeam(input),
      listTeams: async (input: { organizationId: string; page: number; limit: number }) =>
        directory.listTeams(input),
      createTeam: async (input: { organizationId: string; name: string }) =>
        directory.createTeam(input),
      updateTeam: async (input: { teamId: string; organizationId: string; name?: string }) =>
        directory.updateTeam(input),
      archiveTeam: async (input: { teamId: string; organizationId: string }) =>
        directory.archiveTeam(input),
      addTeamMember: async (input: {
        teamId: string;
        organizationId: string;
        userId: string;
        role: string;
      }) => directory.addTeamMember(input),
      removeTeamMember: async (input: {
        teamId: string;
        organizationId: string;
        userId: string;
      }) => directory.removeTeamMember(input),
    },
    "organization",
  );

  const permissions: AuthzService = namedAbsences(
    {
      hasApiKeyPermission: async (input: { apiKeyId: string }) => input.apiKeyId === ADMIN_KEY_ID,
      listScopeBindings: async (input: { scopeIds: readonly string[] }) =>
        directory.scopeBindings(input),
    },
    "authorization",
  );

  const apiKeys: ApiKeyService = namedAbsences(
    {
      resolveOrganizationToken: async (input: { token: string }) => {
        const apiKeyId =
          input.token === ADMIN_TOKEN
            ? ADMIN_KEY_ID
            : input.token === VIEWER_TOKEN
              ? VIEWER_KEY_ID
              : null;
        if (!apiKeyId) return { ok: false as const, reason: "unusable_credential" as const };
        return {
          ok: true as const,
          resolved: {
            type: "apiKey-org" as const,
            apiKeyId,
            userId: OWNER_USER_ID,
            organizationId: TEST_ORGANIZATION_ID,
          },
        };
      },
      markUsed: () => {},
    },
    "api-key",
  );

  const api = mountRestFamily({
    packaged: {
      organizations: () => organizations,
      permissions: () => permissions,
      projects: () => namedAbsences({}, "project") as ProjectService,
    },
    security: ApiRestSecurity.create({
      apiKeys,
      authz: permissions,
      organizations,
      observability: ApiRestObservabilityComposition.create(),
    }),
  });

  return { api, directory };
}
