/**
 * ADR-175: what an aggregate rule accepts and which projects it resolves to, over
 * two organisations' memory rows; organisation answers who sits in which department.
 * @see specs/governance/aggregate-project.feature
 */
import { TeamNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import {
  AGGREGATE_DEFAULT_RULE,
  PROJECT_KIND,
  projectSchema,
  type AggregateRule,
  type Project,
  type Team,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAggregateRuleRepository } from "../../repositories/memory/memory.aggregate-rule.repository.ts";
import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import type { AggregateAccessService } from "../aggregate-access.service.ts";
import { AggregateRuleService } from "../aggregate-rule.service.ts";
import { ProjectCreatedNoticeService } from "../project-created-notice.service.ts";
import { ProjectService } from "../project.service.ts";

const NOW = new Date("2026-10-06T00:00:00.000Z");

function team(id: string, organizationId: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: id,
    slug: id,
    organizationId,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
    ...overrides,
  };
}

function project(id: string, teamId: string, overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    id,
    name: id,
    slug: id,
    apiKey: `key-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId,
    language: "other",
    framework: "other",
    kind: PROJECT_KIND.APPLICATION,
    firstMessage: false,
    integrated: false,
    createdAt: NOW,
    updatedAt: NOW,
    userLinkTemplate: null,
    traceSharingEnabled: true,
    presenceEnabled: true,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...overrides,
  });
}

/** org_a holds two personal projects, a team project and the governance record; org_b one. */
function seeded() {
  const database = MemoryProjectDatabase.create();
  database.putTeam(team("team_a", "org_a"));
  database.putTeam(team("team_eng", "org_a", { isPersonal: true, ownerUserId: "u_eng" }));
  database.putTeam(team("team_sales", "org_a", { isPersonal: true, ownerUserId: "u_sales" }));
  database.putTeam(team("team_b", "org_b"));
  database.putProject(
    project("p_eng", "team_eng", { isPersonal: true, ownerUserId: "u_eng", name: "Eng" }),
  );
  database.putProject(
    project("p_sales", "team_sales", { isPersonal: true, ownerUserId: "u_sales", name: "Sales" }),
  );
  database.putProject(project("p_team", "team_a", { name: "Team" }));
  database.putProject(
    project("p_gov", "team_a", { kind: PROJECT_KIND.INTERNAL_GOVERNANCE, name: "Gov" }),
  );
  database.putProject(project("p_agg", "team_a", { kind: PROJECT_KIND.AGGREGATE, name: "Agg" }));
  database.putProject(project("p_old", "team_a", { archivedAt: NOW, name: "Old" }));
  database.putProject(
    project("p_foreign", "team_b", { isPersonal: true, ownerUserId: "u_foreign" }),
  );
  return database;
}

const MEMBERS = {
  org_a: [
    { userId: "u_eng", departmentId: "dep_eng", user: { name: "Eng", email: "eng@acme.test" } },
    {
      userId: "u_sales",
      departmentId: "dep_sales",
      user: { name: "Sales", email: "sales@acme.test" },
    },
  ],
  org_b: [{ userId: "u_foreign", departmentId: "dep_foreign", user: { name: null, email: null } }],
} as const;

const organizations = createApiFixture<OrganizationApi>({
  findMembersWithDepartments: async ({ organizationId }) => [
    ...(MEMBERS[organizationId as keyof typeof MEMBERS] ?? []),
  ],
});

function serviceOver(database: MemoryProjectDatabase): AggregateRuleService {
  return AggregateRuleService.create({
    repository: MemoryAggregateRuleRepository.create({ memory: database }),
    organizations,
  });
}

describe("given a rule that names a project in another organisation", () => {
  const foreignRule: AggregateRule = { kind: "explicit", projectIds: ["p_team", "p_foreign"] };

  describe("when the rule is validated", () => {
    /** @scenario "A rule that names a project in another organisation is refused" */
    it("is refused with a named error", async () => {
      await expect(
        serviceOver(seeded()).assertValid({ rule: foreignRule, organizationId: "org_a" }),
      ).rejects.toMatchObject({ code: "aggregate_rule_outside_organization" });
    });

    it("is refused the same way for a department of another organisation", async () => {
      await expect(
        serviceOver(seeded()).assertValid({
          rule: { kind: "personal-by-department", departmentId: "dep_foreign" },
          organizationId: "org_a",
        }),
      ).rejects.toMatchObject({ code: "aggregate_rule_outside_organization" });
    });

    it("refuses a list that names the hidden governance project or another aggregate", async () => {
      const service = serviceOver(seeded());

      for (const named of ["p_gov", "p_agg", "p_old"]) {
        await expect(
          service.assertValid({
            rule: { kind: "explicit", projectIds: ["p_team", named] },
            organizationId: "org_a",
          }),
        ).rejects.toMatchObject({ code: "aggregate_rule_outside_organization" });
      }
    });
  });

  describe("when an aggregate project is created with it", () => {
    /** @scenario "A rule that names a project in another organisation is refused" */
    it("writes no team, no project and no grant", async () => {
      const database = seeded();
      const before = database.projects().length;
      const teamsCreated: string[] = [];
      const projects = ProjectService.create({
        aggregateAccess: createApiFixture<Pick<AggregateAccessService, "listsAggregatesTo">>({}),
        repository: MemoryProjectRepository.create({ memory: database }),
        credentials: { generateProjectId: () => "p_new", generateApiKey: () => "sk-lw-new" },
        organizations: createApiFixture<OrganizationApi>({
          createTeamWithMembers: async (input) => {
            teamsCreated.push(input.name);
            throw new Error("a team was created for a refused rule");
          },
        }),
        created: ProjectCreatedNoticeService.create({
          logger: { error: () => void 0 },
          projects: {
            findWithOrgAdmin: async () => null,
            findIdsByOrganization: async () => [],
            findWithTeam: async () => null,
          },
        }),
        aggregateRules: serviceOver(database),
      });

      await expect(
        projects.create({
          organizationId: "org_a",
          newTeamName: "Leadership",
          userId: "u_admin",
          name: "Company view",
          language: "other",
          framework: "other",
          kind: PROJECT_KIND.AGGREGATE,
          aggregateRule: foreignRule,
        }),
      ).rejects.toMatchObject({ code: "aggregate_rule_outside_organization" });

      expect(teamsCreated).toEqual([]);
      expect(database.projects()).toHaveLength(before);
    });
  });
});

describe("given a valid rule", () => {
  describe("when an admin creates an aggregate project without naming a rule", () => {
    /** @scenario "An admin creates an aggregate project from the new-project flow" */
    it("stores the all-personal rule and attaches the project to the chosen team", async () => {
      const database = seeded();
      const projects = ProjectService.create({
        aggregateAccess: createApiFixture<Pick<AggregateAccessService, "listsAggregatesTo">>({}),
        repository: MemoryProjectRepository.create({ memory: database }),
        credentials: { generateProjectId: () => "p_view", generateApiKey: () => "sk-lw-view" },
        organizations: createApiFixture<OrganizationApi>({
          getTeam: async ({ teamId, organizationId }) => {
            const found = database.findTeam(teamId);
            if (!found || found.organizationId !== organizationId) {
              throw new TeamNotFoundError(teamId);
            }
            return found;
          },
        }),
        created: ProjectCreatedNoticeService.create({
          logger: { error: () => void 0 },
          projects: {
            findWithOrgAdmin: async () => null,
            findIdsByOrganization: async () => [],
            findWithTeam: async () => null,
          },
        }),
        aggregateRules: serviceOver(database),
      });

      const created = await projects.create({
        organizationId: "org_a",
        teamId: "team_a",
        userId: "u_admin",
        name: "Company view",
        language: "other",
        framework: "other",
        kind: PROJECT_KIND.AGGREGATE,
      });

      expect(database.findProject(created.id)).toMatchObject({
        kind: PROJECT_KIND.AGGREGATE,
        aggregateRule: AGGREGATE_DEFAULT_RULE,
        teamId: "team_a",
      });
      expect(
        await serviceOver(database).membersOf({
          rule: AGGREGATE_DEFAULT_RULE,
          organizationId: "org_a",
          aggregateProjectId: created.id,
        }),
      ).toEqual(["p_eng", "p_sales"]);
    });
  });

  describe("when its members are resolved", () => {
    it("reads every personal project of the organisation for all-personal", async () => {
      expect(
        await serviceOver(seeded()).membersOf({
          rule: AGGREGATE_DEFAULT_RULE,
          organizationId: "org_a",
        }),
      ).toEqual(["p_eng", "p_sales"]);
    });

    /** @scenario "The rule may be narrowed to one department" */
    it("reads only the department's personal projects for a department rule", async () => {
      expect(
        await serviceOver(seeded()).membersOf({
          rule: { kind: "personal-by-department", departmentId: "dep_eng" },
          organizationId: "org_a",
        }),
      ).toEqual(["p_eng"]);
    });

    /** @scenario "The rule may name an explicit list of any projects" */
    it("reads exactly the named projects, personal or not, for an explicit rule", async () => {
      expect(
        await serviceOver(seeded()).membersOf({
          rule: { kind: "explicit", projectIds: ["p_team", "p_sales"] },
          organizationId: "org_a",
        }),
      ).toEqual(["p_sales", "p_team"]);
    });

    it("never counts the aggregate as its own member", async () => {
      expect(
        await serviceOver(seeded()).membersOf({
          rule: { kind: "explicit", projectIds: ["p_team", "p_eng"] },
          organizationId: "org_a",
          aggregateProjectId: "p_team",
        }),
      ).toEqual(["p_eng"]);
    });

    it("drops a named project that is no longer readable instead of failing", async () => {
      expect(
        await serviceOver(seeded()).membersOf({
          rule: { kind: "explicit", projectIds: ["p_team", "p_gov"] },
          organizationId: "org_a",
        }),
      ).toEqual(["p_team"]);
    });
  });

  describe("when the admin lists the projects she may pick", () => {
    /** @scenario "The admin sees every member's personal workspace under Personal projects" */
    it("lists each personal workspace with its owner and the shared project without one", async () => {
      const candidates = await serviceOver(seeded()).candidateMembers({ organizationId: "org_a" });
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

      expect(byId.get("p_eng")).toMatchObject({
        isPersonal: true,
        owner: { name: "Eng", email: "eng@acme.test" },
      });
      expect(byId.get("p_sales")).toMatchObject({
        isPersonal: true,
        owner: { name: "Sales", email: "sales@acme.test" },
      });
      expect(byId.get("p_team")).toMatchObject({ isPersonal: false, owner: null });
    });

    /** @scenario "The project picker leaves out aggregates and the governance project" */
    it("lists neither aggregates, the governance project nor another organisation's", async () => {
      const ids = (await serviceOver(seeded()).candidateMembers({ organizationId: "org_a" })).map(
        (candidate) => candidate.id,
      );

      expect(ids).toEqual(["p_eng", "p_sales", "p_team"]);
    });
  });
});
