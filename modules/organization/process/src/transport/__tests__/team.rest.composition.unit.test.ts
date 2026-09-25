import type { Project } from "@langwatch/project-contract";
/**
 * @vitest-environment node
 * The `/api/teams` family against the real composed application, not a
 * stub — the prior version lost its only caller silently and every
 * operation 404'd for a stretch. Spec: specs/teams/teams-rest-api.feature
 */
import { Temporal, toDate, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ServerOrganizationApp } from "../../app/organization.app.ts";
import type {
  OrganizationGrantCache,
  OrganizationPromptSeed,
  OrganizationSeatLicense,
  OrganizationSessionRevocation,
  OrganizationSettingsSecret,
} from "../../app/organization.members.ts";
import { MemoryGroupRepository } from "../../repositories/memory/memory.group.repository.ts";
import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import { MemoryTeamRepository } from "../../repositories/memory/memory.team.repository.ts";
import { GroupIdentityService } from "../../services/group-identity.service.ts";
import { OrganizationMembershipService } from "../../services/organization-membership.service.ts";
import { OrganizationService } from "../../services/organization.service.ts";
import { PersonalWorkspaceIdentityService } from "../../services/personal-workspace-identity.service.ts";
import { TeamIdentityService } from "../../services/team-identity.service.ts";
import { TestAuthzApi } from "./support/test-authz-api.ts";
import { TestProjectApi } from "./support/test-project-api.ts";
import {
  CREDENTIAL,
  ORGANIZATION_ID,
  USER_ID,
  VIEWER_PERMISSIONS,
  mountTeamsRestApplication,
  type TeamRestRefusal,
} from "./team.rest.harness.ts";

const OTHER_ORGANIZATION_ID = "organization-other";
const SHARED_TEAM_ID = "team_shared";
const OTHER_TEAM_ID = "team_elsewhere";
const PERSONAL_TEAM_ID = "team_personal";
const ARCHIVED_TEAM_ID = "team_archived";
const COLLEAGUE_ID = "user-colleague";
const OUTSIDER_ID = "user-outsider";
const NOW = Temporal.Instant.from("2026-09-01T00:00:00.000Z");

const passthroughSecrets: OrganizationSettingsSecret = {
  encrypt: (value) => value,
  decrypt: (value) => value,
};

/**
 * The membership half of the application. The teams family never reaches it —
 * every member here refuses rather than answering, so a route that started
 * reading organization membership through this door would fail loudly.
 */
const unreachablePromptSeed: OrganizationPromptSeed = {
  seedTagsForOrganization: () => Promise.reject(new Error("prompt seeding is not reached")),
  reportCompensationFailure: () => {
    throw new Error("prompt compensation is not reached");
  },
};

const unreachableSeats: OrganizationSeatLicense = {
  checkLimit: () => Promise.reject(new Error("seat limits are not reached")),
  assertRoleChangeAllowed: () => Promise.reject(new Error("seat limits are not reached")),
};

const unreachableSessions: OrganizationSessionRevocation = {
  revokeAllBrowserSessions: () => Promise.reject(new Error("session revocation is not reached")),
};

const unreachableGrantCache: OrganizationGrantCache = {
  invalidateOrganization: () => Promise.reject(new Error("grant caching is not reached")),
};

function teamRow(
  overrides: Partial<{
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    isPersonal: boolean;
    ownerUserId: string | null;
    archivedAt: Instant | null;
  }> = {},
) {
  return {
    id: SHARED_TEAM_ID,
    name: "Shared Team",
    slug: "shared-team",
    organizationId: ORGANIZATION_ID,
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** One project row, as the project boundary answers `listByTeam` with. */
function projectRow(overrides: Partial<Project> = {}): Project {
  return {
    id: "project_1",
    name: "First Project",
    slug: "first-project",
    apiKey: "sk-lw-base-key-of-the-project",
    lwqlKey: "lwql-key",
    teamId: SHARED_TEAM_ID,
    language: "python",
    framework: "langchain",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: toDate(NOW),
    updatedAt: toDate(NOW),
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...overrides,
  };
}

/**
 * The application as `ServerOrganizationApp` is wired at boot: real
 * organization and membership services over the module's own in-memory
 * repositories, with authorization and projects as complete doubles.
 */
function application() {
  const memory = MemoryOrganizationDatabase.create();

  memory.organizations.set(ORGANIZATION_ID, {
    id: ORGANIZATION_ID,
    name: "ACME",
    slug: "acme",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  memory.teams.set(SHARED_TEAM_ID, teamRow());
  memory.teams.set(
    OTHER_TEAM_ID,
    teamRow({
      id: OTHER_TEAM_ID,
      name: "Another Organization's Team",
      slug: "another-organizations-team",
      organizationId: OTHER_ORGANIZATION_ID,
    }),
  );
  memory.teams.set(
    PERSONAL_TEAM_ID,
    teamRow({
      id: PERSONAL_TEAM_ID,
      name: "Owner's Workspace",
      slug: "--personal-owner",
      isPersonal: true,
      ownerUserId: USER_ID,
    }),
  );
  memory.teams.set(
    ARCHIVED_TEAM_ID,
    teamRow({
      id: ARCHIVED_TEAM_ID,
      name: "Retired Team",
      slug: "retired-team",
      archivedAt: Temporal.Instant.from("2026-08-01T00:00:00.000Z"),
    }),
  );

  for (const userId of [USER_ID, COLLEAGUE_ID]) {
    memory.organizationUsers.push({
      userId,
      organizationId: ORGANIZATION_ID,
      role: "ADMIN",
      disabledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  const permissions = TestAuthzApi.create({
    people: [
      { id: USER_ID, name: "Workspace Owner", email: "owner@acme.test" },
      { id: COLLEAGUE_ID, name: "Colleague", email: "colleague@acme.test" },
    ],
  });
  permissions.seedTeamBinding({
    id: "binding-owner-shared",
    organizationId: ORGANIZATION_ID,
    teamId: SHARED_TEAM_ID,
    userId: USER_ID,
    role: "ADMIN",
  });
  permissions.seedTeamBinding({
    id: "binding-owner-personal",
    organizationId: ORGANIZATION_ID,
    teamId: PERSONAL_TEAM_ID,
    userId: USER_ID,
    role: "ADMIN",
  });

  const projects = TestProjectApi.create({
    byTeam: { [SHARED_TEAM_ID]: [projectRow()] },
  });

  const organizations = OrganizationService.create({
    repository: MemoryOrganizationRepository.create({ memory }),
    teams: MemoryTeamRepository.create({ memory }),
    groups: MemoryGroupRepository.create({ memory }),
    identities: PersonalWorkspaceIdentityService.create(),
    teamIdentities: TeamIdentityService.create(),
    groupIdentities: GroupIdentityService.create(),
    authz: permissions,
    grants: permissions,
    settingsSecrets: passthroughSecrets,
  });

  const membership = OrganizationMembershipService.create({
    repository: MemoryOrganizationMembershipRepository.create({ memory }),
    prompts: unreachablePromptSeed,
    seats: unreachableSeats,
    sessions: unreachableSessions,
    grantCache: unreachableGrantCache,
    testArrivals: { standingFor: async () => ({ testing: false }) as const },
    admissions: {
      attachBindings: () => Promise.reject(new Error("no admission expected")),
      completeAdmission: () => Promise.reject(new Error("no admission expected")),
    },
  });

  const app = ServerOrganizationApp.createForTesting({
    dependencies: {
      organizations,
      membership,
      projects,
      permissions,
    },
  });

  return { app, memory, permissions };
}

/** The refusal body, read once so a test asserts on `code` rather than prose. */
async function refusalOf(response: Response): Promise<TeamRestRefusal> {
  return (await response.json()) as TeamRestRefusal;
}

describe("given the teams REST family over the application the composition builds", () => {
  describe("when the credential is missing or unknown", () => {
    /** @scenario Rejects unauthenticated requests */
    it("answers 401 with no authorization header", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send("/api/teams", { credential: null })).status).toBe(401);
    });

    /** @scenario Rejects invalid API key */
    it("answers 401 for a bearer token the door does not know", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send("/api/teams", { credential: "not-a-key" })).status).toBe(401);
    });
  });

  describe("when a team is created", () => {
    /** @scenario Creates a team */
    it("answers 201 with the team's id, name, slug, organization and timestamps", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send("/api/teams", {
        method: "POST",
        body: { name: "My Test Team" },
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(String(body.id)).toMatch(/^team_/);
      expect(body).toMatchObject({
        name: "My Test Team",
        organizationId: ORGANIZATION_ID,
      });
      expect(body.slug).toEqual(expect.any(String));
      expect(body.createdAt).toEqual(expect.any(String));
      expect(body.updatedAt).toEqual(expect.any(String));
      expect(memory.teams.get(String(body.id))?.name).toBe("My Test Team");
    });

    /**
     * @scenario Rejects create when name is missing
     *
     * The status is the process-wide one: `apps/api`'s canonical envelope
     * rewrites `validation_error` from the validator's 422 to 400 for every
     * family it mounts. The spec was written against the 422 the platform
     * application answered, so the CODE is what this asserts.
     */
    it("refuses an empty body by name, and creates nothing", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app);
      const before = memory.teams.size;

      const refusal = await refusalOf(await send("/api/teams", { method: "POST", body: {} }));

      expect(refusal.code).toBe("validation_error");
      expect(memory.teams.size).toBe(before);
    });

    /** @scenario Rejects create when name is empty */
    it("refuses an empty name by name", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const refusal = await refusalOf(
        await send("/api/teams", { method: "POST", body: { name: "" } }),
      );

      expect(refusal.code).toBe("validation_error");
    });

    /** @scenario Rejects create when name exceeds 255 characters */
    it("refuses a name longer than 255 characters by name", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const refusal = await refusalOf(
        await send("/api/teams", { method: "POST", body: { name: "n".repeat(256) } }),
      );

      expect(refusal.code).toBe("validation_error");
    });
  });

  describe("when the collection is listed", () => {
    /** @scenario Lists non-archived teams for the organization */
    it("answers 200 with a paginated data array", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send("/api/teams");

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { id: string }[];
        pagination: { page: number; limit: number; total: number };
      };
      expect(body.data.map((team) => team.id).toSorted()).toEqual([
        PERSONAL_TEAM_ID,
        SHARED_TEAM_ID,
      ]);
      expect(body.pagination).toMatchObject({ page: 1, limit: 50 });
    });

    /** @scenario Paginates team list */
    it("honours page and limit from the query string", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send("/api/teams?page=1&limit=2");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { pagination: { limit: number } };
      expect(body.pagination.limit).toBe(2);
    });

    /**
     * @scenario Excludes teams from other organizations
     *
     * The tenancy guard, and the reason every route here resolves its
     * organization from the CREDENTIAL rather than from the team it was handed.
     */
    it("never lists a team belonging to another organization", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const body = (await (await send("/api/teams")).json()) as { data: { id: string }[] };

      expect(body.data.map((team) => team.id)).not.toContain(OTHER_TEAM_ID);
    });

    /** @scenario Archived team is excluded from list */
    it("never lists a team that has been archived", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const body = (await (await send("/api/teams")).json()) as { data: { id: string }[] };

      expect(body.data.map((team) => team.id)).not.toContain(ARCHIVED_TEAM_ID);
    });
  });

  describe("when one team is read", () => {
    /** @scenario Returns a team by id */
    it("answers 200 with the team", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: SHARED_TEAM_ID,
        name: "Shared Team",
        organizationId: ORGANIZATION_ID,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    });

    /** @scenario Returns 404 for non-existent team */
    it("answers 404 for a team id nothing holds", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send("/api/teams/team_doesnotexist")).status).toBe(404);
    });

    /** @scenario An unknown team names the code */
    it("names team_not_found rather than a reason phrase", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send("/api/teams/team_doesnotexist");

      expect(response.status).toBe(404);
      expect((await refusalOf(response)).code).toBe("team_not_found");
    });

    /** @scenario Returns 404 for team in another organization */
    it("answers 404 for a team in another organization", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send(`/api/teams/${OTHER_TEAM_ID}`)).status).toBe(404);
    });

    /** @scenario Archived team is inaccessible via GET */
    it("answers 404 for a team that has been archived", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send(`/api/teams/${ARCHIVED_TEAM_ID}`)).status).toBe(404);
    });

    it("answers the family's canonical /api/v1 twin the same way", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/v1/teams/${SHARED_TEAM_ID}`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: SHARED_TEAM_ID });
    });
  });

  describe("when a team is renamed", () => {
    /**
     * @scenario Updates team name
     *
     * `updateTeam`, not `updateTeamWithMembers`: a PATCH carrying a name has no
     * membership array to give, and demanding one would have changed the wire.
     */
    it("answers 200 with the new name and writes it", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}`, {
        method: "PATCH",
        body: { name: "Updated Name" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ name: "Updated Name" });
      expect(memory.teams.get(SHARED_TEAM_ID)?.name).toBe("Updated Name");
    });

    /** @scenario Returns 404 when updating non-existent team */
    it("answers 404 for a team id nothing holds", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send("/api/teams/team_ghost", {
        method: "PATCH",
        body: { name: "Whatever" },
      });

      expect(response.status).toBe(404);
    });

    it("refuses a team in another organization, and writes nothing", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${OTHER_TEAM_ID}`, {
        method: "PATCH",
        body: { name: "Should Not Persist" },
      });

      expect(response.status).toBe(404);
      expect(memory.teams.get(OTHER_TEAM_ID)?.name).toBe("Another Organization's Team");
    });
  });

  describe("when a team is archived", () => {
    /** @scenario Archives a team */
    it("answers 200 with the archive stamp, and archives the row", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}`, { method: "DELETE" });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        id: string;
        name: string;
        archivedAt: string | null;
      };
      expect(body.id).toBe(SHARED_TEAM_ID);
      expect(body.archivedAt).not.toBeNull();
      expect(memory.teams.get(SHARED_TEAM_ID)?.archivedAt).not.toBeNull();
    });

    /** @scenario Returns 404 when deleting non-existent team */
    it("answers 404 for a team id nothing holds", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send("/api/teams/team_nope", { method: "DELETE" })).status).toBe(404);
    });

    /** @scenario Returns 404 when deleting already-archived team */
    it("answers 404 for a team that is already archived", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      expect((await send(`/api/teams/${ARCHIVED_TEAM_ID}`, { method: "DELETE" })).status).toBe(404);
    });

    /**
     * @scenario Refuses to archive a personal team
     *
     * The refusal lives in the service, not in the transport: archiving a
     * personal workspace would keep its (organization, owner) slot forever
     * while the workspace lookup skipped the archived row.
     */
    it("refuses a personal team with its code, and archives nothing", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${PERSONAL_TEAM_ID}`, { method: "DELETE" });

      expect(response.status).toBe(403);
      expect((await refusalOf(response)).code).toBe("personal_workspace_not_managed_here");
      expect(memory.teams.get(PERSONAL_TEAM_ID)?.archivedAt).toBeNull();
    });
  });

  describe("when a team's members are listed", () => {
    it("answers 200 with each member's id, name, email and role", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [
          {
            userId: USER_ID,
            name: "Workspace Owner",
            email: "owner@acme.test",
            role: "ADMIN",
          },
        ],
      });
    });

    /**
     * The pre-flight `getTeam` read is load-bearing, not redundant: without it
     * a foreign team answers an empty membership list instead of a 404, which
     * tells a caller the team exists and is empty.
     */
    it("answers 404 for a team in another organization rather than an empty list", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/teams/${OTHER_TEAM_ID}/members`);

      expect(response.status).toBe(404);
      expect((await refusalOf(response)).code).toBe("team_not_found");
    });
  });

  describe("when a member is added to a team", () => {
    it("answers 201 and attaches the binding", async () => {
      const { app, permissions } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members`, {
        method: "POST",
        body: { userId: COLLEAGUE_ID, role: "MEMBER" },
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(permissions.teamMemberIds(SHARED_TEAM_ID)).toContain(COLLEAGUE_ID);
    });

    /** @scenario Adding somebody who is not in the organization names the code */
    it("refuses a user who does not belong to the organization", async () => {
      const { app, permissions } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members`, {
        method: "POST",
        body: { userId: OUTSIDER_ID, role: "MEMBER" },
      });

      expect(response.status).toBe(422);
      expect((await refusalOf(response)).code).toBe("user_not_in_organization");
      expect(permissions.teamMemberIds(SHARED_TEAM_ID)).not.toContain(OUTSIDER_ID);
    });

    /** @scenario Granting a role a member already holds names the code */
    it("refuses a role the member already holds", async () => {
      const { app } = application();
      const { send } = mountTeamsRestApplication(app);

      await send(`/api/teams/${SHARED_TEAM_ID}/members`, {
        method: "POST",
        body: { userId: COLLEAGUE_ID, role: "MEMBER" },
      });
      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members`, {
        method: "POST",
        body: { userId: COLLEAGUE_ID, role: "MEMBER" },
      });

      expect(response.status).toBe(409);
      expect((await refusalOf(response)).code).toBe("team_member_already_added");
    });

    /** @scenario Refuses to add a member to a personal team */
    it("refuses a personal team with its code, and leaves it holding its owner alone", async () => {
      const { app, permissions } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${PERSONAL_TEAM_ID}/members`, {
        method: "POST",
        body: { userId: COLLEAGUE_ID, role: "MEMBER" },
      });

      expect(response.status).toBe(403);
      expect((await refusalOf(response)).code).toBe("personal_workspace_not_managed_here");
      expect(permissions.teamMemberIds(PERSONAL_TEAM_ID)).toEqual([USER_ID]);
    });
  });

  describe("when a member is removed from a team", () => {
    /**
     * @scenario Removing a member takes every role they hold on the team
     *
     * Permissions at a scope are the union of every role held there, so a
     * removal that reached one binding would leave the member on the team
     * through whichever role it did not reach.
     */
    it("takes every binding they hold on that team", async () => {
      const { app, permissions } = application();
      const { send } = mountTeamsRestApplication(app);
      permissions.seedTeamBinding({
        id: "binding-colleague-member",
        organizationId: ORGANIZATION_ID,
        teamId: SHARED_TEAM_ID,
        userId: COLLEAGUE_ID,
        role: "MEMBER",
      });
      permissions.seedTeamBinding({
        id: "binding-colleague-viewer",
        organizationId: ORGANIZATION_ID,
        teamId: SHARED_TEAM_ID,
        userId: COLLEAGUE_ID,
        role: "VIEWER",
      });

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members/${COLLEAGUE_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(permissions.teamMemberIds(SHARED_TEAM_ID)).not.toContain(COLLEAGUE_ID);
    });

    /** @scenario Removing somebody who holds no role on the team names the code */
    it("refuses somebody who holds no binding on the team", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members/${COLLEAGUE_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      expect((await refusalOf(response)).code).toBe("team_membership_not_found");
    });

    /** @scenario Refuses to remove a member from a personal team */
    it("refuses a personal team's owner with its code, and leaves the binding", async () => {
      const { app, permissions } = application();
      const { send } = mountTeamsRestApplication(app);

      const response = await send(`/api/teams/${PERSONAL_TEAM_ID}/members/${USER_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(403);
      expect((await refusalOf(response)).code).toBe("personal_workspace_not_managed_here");
      expect(permissions.teamMemberIds(PERSONAL_TEAM_ID)).toEqual([USER_ID]);
    });

    /**
     * A service key acts as nobody, so the removal attributes to the
     * management API rather than crashing on an absent actor — the shape
     * `callerOf` builds, distinct from the ledger actor `addTeamMember` uses.
     */
    it("carries out a removal asked for by a service key that acts as nobody", async () => {
      const { app, permissions } = application();
      const { send } = mountTeamsRestApplication(app, { actor: null });
      permissions.seedTeamBinding({
        id: "binding-colleague-member",
        organizationId: ORGANIZATION_ID,
        teamId: SHARED_TEAM_ID,
        userId: COLLEAGUE_ID,
        role: "MEMBER",
      });

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/members/${COLLEAGUE_ID}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      expect(permissions.teamMemberIds(SHARED_TEAM_ID)).not.toContain(COLLEAGUE_ID);
    });
  });

  describe("when a team's projects are listed", () => {
    it("answers 200 with the projects that live in the team", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}/projects`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { id: string }[] };
      expect(body.data.map((project) => project.id)).toEqual(["project_1"]);
    });

    /** The same pre-flight read: a foreign team is absent, not empty. */
    it("answers 404 for a team in another organization rather than an empty list", async () => {
      const { send } = mountTeamsRestApplication(application().app);

      const response = await send(`/api/teams/${OTHER_TEAM_ID}/projects`);

      expect(response.status).toBe(404);
      expect((await refusalOf(response)).code).toBe("team_not_found");
    });
  });

  describe("when the credential is a viewer-scoped organization key", () => {
    const viewer = { granted: VIEWER_PERMISSIONS };

    /**
     * @scenario Viewer cannot list teams
     *
     * A VIEWER binding at the organization carries neither `team:view` nor
     * `team:manage`, so the refusal is on the request's merits: 403, from a
     * credential the door recognised.
     */
    it("answers 403 when it lists teams", async () => {
      const { send } = mountTeamsRestApplication(application().app, viewer);

      expect((await send("/api/teams", { credential: CREDENTIAL })).status).toBe(403);
    });

    /** @scenario Viewer cannot create a team */
    it("answers 403 when it creates a team", async () => {
      const { send } = mountTeamsRestApplication(application().app, viewer);

      const response = await send("/api/teams", {
        method: "POST",
        body: { name: "Blocked Team" },
      });

      expect(response.status).toBe(403);
    });

    /** @scenario Viewer cannot update a team */
    it("answers 403 when it renames a team", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app, viewer);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}`, {
        method: "PATCH",
        body: { name: "Nope" },
      });

      expect(response.status).toBe(403);
      expect(memory.teams.get(SHARED_TEAM_ID)?.name).toBe("Shared Team");
    });

    /** @scenario Viewer cannot delete a team */
    it("answers 403 when it archives a team", async () => {
      const { app, memory } = application();
      const { send } = mountTeamsRestApplication(app, viewer);

      const response = await send(`/api/teams/${SHARED_TEAM_ID}`, { method: "DELETE" });

      expect(response.status).toBe(403);
      expect(memory.teams.get(SHARED_TEAM_ID)?.archivedAt).toBeNull();
    });
  });
});
