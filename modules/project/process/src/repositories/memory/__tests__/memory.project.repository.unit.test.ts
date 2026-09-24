import { PROJECT_KIND, ProjectNotFoundError, type Team } from "@langwatch/project-contract";
import { fromDate } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../memory.project.database.ts";
import { MemoryProjectRepository } from "../memory.project.repository.ts";

const ORGANIZATION_ID = "organization_1";
const TEAM_ID = "team_1";

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: TEAM_ID,
    name: "Engineering",
    slug: "engineering",
    organizationId: ORGANIZATION_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
    ...overrides,
  };
}

function seeded() {
  const database = MemoryProjectDatabase.create();
  database.putOrganization({
    id: ORGANIZATION_ID,
    name: "Acme",
    presenceEnabled: true,
    traceSharingEnabled: true,
    adminUserIds: ["user_admin", "user_second"],
    onboardingVariant: null,
    createdAt: fromDate(new Date("2026-01-01T00:00:00.000Z")),
  });
  database.putTeam(team());

  return { database, repository: MemoryProjectRepository.create({ memory: database }) };
}

const creation = {
  id: "project_1",
  name: "Checkout assistant",
  slug: "checkout-assistant",
  apiKey: "sk-lw-1",
  teamId: TEAM_ID,
  language: "python",
  framework: "openai",
};

describe("MemoryProjectRepository", () => {
  describe("given a project created in a team", () => {
    it("reads it back with its team and the organization path", async () => {
      const { repository } = seeded();

      const project = await repository.create(creation);
      expect(project).toMatchObject({ id: "project_1", archivedAt: null, kind: "application" });

      expect(await repository.findWithTeam("project_1")).toMatchObject({
        id: "project_1",
        team: { id: TEAM_ID, organizationId: ORGANIZATION_ID },
      });
      expect(await repository.findPaths({ projectIds: ["project_1"] })).toEqual([
        { projectId: "project_1", fullPath: "Acme / Engineering / Checkout assistant" },
      ]);
      expect(await repository.findOrganizationId("project_1")).toBe(ORGANIZATION_ID);
    });

    it("answers presence only when the organization enables it too", async () => {
      const { database, repository } = seeded();
      await repository.create(creation);

      expect(await repository.isPresenceEnabled("project_1")).toBe(true);

      database.putOrganization({
        id: ORGANIZATION_ID,
        name: "Acme",
        presenceEnabled: false,
        traceSharingEnabled: true,
        adminUserIds: [],
        onboardingVariant: null,
        createdAt: fromDate(new Date("2026-01-01T00:00:00.000Z")),
      });
      expect(await repository.isPresenceEnabled("project_1")).toBe(false);
    });

    it("names the organization's oldest admin for the first-trace milestone", async () => {
      const { repository } = seeded();
      await repository.create(creation);

      expect(await repository.findWithOrgAdmin("project_1")).toEqual({
        firstMessage: false,
        organizationId: ORGANIZATION_ID,
        adminUserId: "user_admin",
        onboardingVariant: null,
        organizationCreatedAt: fromDate(new Date("2026-01-01T00:00:00.000Z")),
      });
    });
  });

  describe("when a project is archived", () => {
    let repository: MemoryProjectRepository;

    beforeEach(async () => {
      ({ repository } = seeded());
      await repository.create(creation);
      await repository.archive({ id: "project_1", organizationId: ORGANIZATION_ID });
    });

    it("hides it from the listings and refuses a second archive", async () => {
      expect(await repository.findWithTeam("project_1")).toBeNull();
      expect(
        await repository.findAllByTeam({ organizationId: ORGANIZATION_ID, teamId: TEAM_ID }),
      ).toEqual([]);
      expect(
        await repository.findAllByOrganization({
          organizationId: ORGANIZATION_ID,
          page: 1,
          limit: 10,
        }),
      ).toEqual({ data: [], pagination: { page: 1, limit: 10, total: 0 } });

      await expect(
        repository.archive({ id: "project_1", organizationId: ORGANIZATION_ID }),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it("still follows a stored trace-destination pointer to it", async () => {
      expect(await repository.findTraceDestination("project_1")).toMatchObject({
        id: "project_1",
        teamId: TEAM_ID,
        apiKey: "sk-lw-1",
      });
      expect(
        await repository.findLiveTraceDestination({
          organizationId: ORGANIZATION_ID,
          projectId: "project_1",
        }),
      ).toBeNull();
    });
  });

  describe("when another organization asks", () => {
    it("refuses the update and lists nothing", async () => {
      const { repository } = seeded();
      await repository.create(creation);

      await expect(
        repository.update({ id: "project_1", organizationId: "organization_2", data: {} }),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
      expect(await repository.findIdsByOrganization("organization_2")).toEqual([]);
      expect(
        await repository.searchByQuery({ query: "checkout", organizationId: "organization_2" }),
      ).toEqual([]);
      expect(await repository.searchByQuery({ query: "CHECKOUT" })).toEqual([
        { id: "project_1", name: "Checkout assistant", slug: "checkout-assistant" },
      ]);
    });
  });

  describe("when a coding-agent fold stamps activity", () => {
    it("writes the first stamp and throttles a second one inside the window", async () => {
      const { repository } = seeded();
      await repository.create(creation);
      const first = new Date("2026-08-25T12:00:00.000Z");

      await repository.touchCodingAgentSessionSeen({
        projectId: "project_1",
        at: fromDate(first),
        staleBefore: fromDate(new Date("2026-08-25T11:00:00.000Z")),
      });
      expect((await repository.findById("project_1"))?.lastCodingAgentSessionAt).toEqual(first);

      await repository.touchCodingAgentSessionSeen({
        projectId: "project_1",
        at: fromDate(new Date("2026-08-25T12:30:00.000Z")),
        staleBefore: fromDate(new Date("2026-08-25T11:30:00.000Z")),
      });
      expect((await repository.findById("project_1"))?.lastCodingAgentSessionAt).toEqual(first);
      expect((await repository.findById("project_1"))?.lastCodingAgentPullRequestAt).toBeNull();
    });
  });

  describe("when the internal governance project is minted twice at once", () => {
    it("answers the winner rather than a second project", async () => {
      const { repository } = seeded();

      const minted = await repository.createInternalOrFindWinner({
        id: "project_internal",
        name: "Governance (internal)",
        slug: `governance-${ORGANIZATION_ID}`,
        apiKey: "sk-lw-internal",
        teamId: TEAM_ID,
      });
      const loser = await repository.createInternalOrFindWinner({
        id: "project_internal_second",
        name: "Governance (internal)",
        slug: `governance-${ORGANIZATION_ID}`,
        apiKey: "sk-lw-internal-second",
        teamId: TEAM_ID,
      });

      expect(loser).toEqual(minted);
      expect(await repository.findInternalByOrganization(ORGANIZATION_ID)).toEqual(minted);
      expect(await repository.countLiveNonGovernanceProjects(ORGANIZATION_ID)).toBe(0);
      expect(
        await repository.findAllByTeam({ organizationId: ORGANIZATION_ID, teamId: TEAM_ID }),
      ).toEqual([]);
    });
  });

  /**
   * Moved from the API-key module with the queries themselves: the legacy
   * project credential and personal-workspace ownership are project rows, so
   * the module that owns the tables owns the behaviour too.
   */
  describe("when a legacy project key is rotated", () => {
    it("answers false for a project this store holds no live row for", async () => {
      const { repository } = seeded();

      expect(await repository.rotateLegacyApiKey({ projectId: "project_1", token: "new" })).toBe(
        false,
      );
    });

    it("resolves the project through the new key and no longer through the old", async () => {
      const { repository } = seeded();
      await repository.create(creation);

      expect(await repository.rotateLegacyApiKey({ projectId: "project_1", token: "new" })).toBe(
        true,
      );
      expect(await repository.findIdByLegacyApiKey({ token: "new" })).toBe("project_1");
      expect(await repository.findIdByLegacyApiKey({ token: "sk-lw-1" })).toBeNull();
    });

    it("leaves an archived project out of both answers", async () => {
      const { repository } = seeded();
      await repository.create(creation);
      await repository.archive({ id: "project_1", organizationId: ORGANIZATION_ID });

      expect(await repository.findIdByLegacyApiKey({ token: "sk-lw-1" })).toBeNull();
      expect(await repository.rotateLegacyApiKey({ projectId: "project_1", token: "new" })).toBe(
        false,
      );
    });
  });

  describe("when either trace-sharing kill switch is off", () => {
    it("reports the project's own setting beside the organisation's", async () => {
      const { database, repository } = seeded();
      await repository.create(creation);
      const project = await repository.findById("project_1");
      if (project) database.putProject({ ...project, traceSharingEnabled: false });

      expect(await repository.findTraceSharingConfig("project_1")).toEqual({
        orgEnabled: true,
        projectEnabled: false,
      });
    });

    it("answers nothing for a project it never saw", async () => {
      const { repository } = seeded();

      expect(await repository.findTraceSharingConfig("project_other")).toBeNull();
    });
  });

  describe("when a personal project's owner is asked for", () => {
    it("answers null for a scope this store records no personal workspace for", async () => {
      const { repository } = seeded();

      expect(
        await repository.findPersonalProjectOwner({
          organizationId: ORGANIZATION_ID,
          scopeId: TEAM_ID,
        }),
      ).toBeNull();
    });

    it("answers the owner of the team a personal project hangs from", async () => {
      const { database, repository } = seeded();
      database.putTeam(team({ id: "team_personal", isPersonal: true, ownerUserId: "user_1" }));
      await repository.create({
        ...creation,
        id: "project_personal",
        slug: "personal",
        teamId: "team_personal",
      });

      expect(
        await repository.findPersonalProjectOwner({
          organizationId: ORGANIZATION_ID,
          scopeId: "project_personal",
        }),
      ).toEqual({ ownerUserId: "user_1" });
    });

    it("answers the owner of an archived personal project, as main did", async () => {
      const { database, repository } = seeded();
      database.putTeam(team({ id: "team_personal", isPersonal: true, ownerUserId: "user_1" }));
      await repository.create({
        ...creation,
        id: "project_archived",
        slug: "archived",
        teamId: "team_personal",
      });
      await repository.archive({ id: "project_archived", organizationId: ORGANIZATION_ID });

      expect(
        await repository.findPersonalProjectOwner({
          organizationId: ORGANIZATION_ID,
          scopeId: "project_archived",
        }),
      ).toEqual({ ownerUserId: "user_1" });
    });

    it("answers null for a scope in another organization", async () => {
      const { database, repository } = seeded();
      database.putTeam(
        team({
          id: "team_personal",
          isPersonal: true,
          ownerUserId: "user_1",
          organizationId: "organization_2",
        }),
      );
      await repository.create({
        ...creation,
        id: "project_elsewhere",
        slug: "elsewhere",
        teamId: "team_personal",
      });

      expect(
        await repository.findPersonalProjectOwner({
          organizationId: ORGANIZATION_ID,
          scopeId: "project_elsewhere",
        }),
      ).toBeNull();
    });
  });

  describe("when projects are pointed at departments", () => {
    it("lists the organization's projects by name, leaving the governance project out", async () => {
      const { database, repository } = seeded();
      await repository.create(creation);
      const internal = await repository.create({
        ...creation,
        id: "project_gov",
        name: "Aaa",
        slug: "gov",
      });
      database.putProject({ ...internal, kind: PROJECT_KIND.INTERNAL_GOVERNANCE });

      await expect(
        repository.assignProjectDepartment({
          organizationId: ORGANIZATION_ID,
          projectId: "project_1",
          departmentId: "dept_eng",
        }),
      ).resolves.toBe(true);
      await expect(
        repository.assignProjectDepartment({
          organizationId: "elsewhere",
          projectId: "project_1",
          departmentId: null,
        }),
      ).resolves.toBe(false);
      expect(
        await repository.findProjectsWithDepartments({ organizationId: ORGANIZATION_ID }),
      ).toEqual([{ id: "project_1", name: "Checkout assistant", departmentId: "dept_eng" }]);
    });
  });
});
