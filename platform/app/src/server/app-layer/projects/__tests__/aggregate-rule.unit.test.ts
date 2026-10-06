/**
 * ADR-144 block D: what an aggregate rule accepts and which projects it
 * resolves to. An in-memory repository holding two organisations stands in for
 * Postgres; the integration suite proves the Prisma reads agree with it.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it, vi } from "vitest";
import {
  AGGREGATE_DEFAULT_RULE,
  AGGREGATE_RULE_KINDS,
  type AggregateRule,
  AggregateRuleOutsideOrganizationError,
  aggregateRuleSchema,
} from "../aggregate-rule";
import { AggregateRuleService } from "../aggregate-rule.service";
import { ProjectService } from "../project.service";
import { AGGREGATE_PROJECT_KIND } from "../project-kinds";
import type { AggregateRuleRepository } from "../repositories/aggregate-rule.repository";
import type { ProjectRepository } from "../repositories/project.repository";

type StoredProject = {
  id: string;
  organizationId: string;
  isPersonal: boolean;
  ownerDepartmentId?: string;
  readable?: boolean;
};

const PROJECTS: StoredProject[] = [
  {
    id: "p_eng",
    organizationId: "org_a",
    isPersonal: true,
    ownerDepartmentId: "dep_eng",
  },
  {
    id: "p_sales",
    organizationId: "org_a",
    isPersonal: true,
    ownerDepartmentId: "dep_sales",
  },
  { id: "p_team", organizationId: "org_a", isPersonal: false },
  { id: "p_gov", organizationId: "org_a", isPersonal: false, readable: false },
  { id: "p_foreign", organizationId: "org_b", isPersonal: true },
];
const DEPARTMENTS = [
  { id: "dep_eng", organizationId: "org_a" },
  { id: "dep_sales", organizationId: "org_a" },
  { id: "dep_foreign", organizationId: "org_b" },
];

const memoryRepository: AggregateRuleRepository = {
  findPersonalProjectIds: async ({ organizationId, departmentId }) =>
    PROJECTS.filter(
      (project) =>
        project.organizationId === organizationId &&
        project.isPersonal &&
        project.readable !== false &&
        (departmentId === undefined ||
          project.ownerDepartmentId === departmentId),
    ).map((project) => project.id),
  findReadableProjectIds: async ({ organizationId, projectIds }) =>
    PROJECTS.filter(
      (project) =>
        projectIds.includes(project.id) &&
        project.organizationId === organizationId &&
        project.readable !== false,
    ).map((project) => project.id),
  departmentBelongsTo: async ({ organizationId, departmentId }) =>
    DEPARTMENTS.some(
      (department) =>
        department.id === departmentId &&
        department.organizationId === organizationId,
    ),
};

const service = new AggregateRuleService(memoryRepository);

describe("given the aggregate rule shapes", () => {
  it("names the three kinds the ADR fixes, and defaults to all personal projects", () => {
    expect(AGGREGATE_RULE_KINDS).toEqual([
      "all-personal",
      "personal-by-department",
      "explicit",
    ]);
    expect(aggregateRuleSchema.parse(AGGREGATE_DEFAULT_RULE)).toEqual({
      kind: "all-personal",
    });
  });

  it("refuses an explicit rule with no projects and a shape with stray fields", () => {
    expect(
      aggregateRuleSchema.safeParse({ kind: "explicit", projectIds: [] })
        .success,
    ).toBe(false);
    expect(
      aggregateRuleSchema.safeParse({ kind: "all-personal", where: "x" })
        .success,
    ).toBe(false);
  });
});

describe("given a rule that names a project in another organisation", () => {
  const foreignRule: AggregateRule = {
    kind: "explicit",
    projectIds: ["p_team", "p_foreign"],
  };

  /** @scenario "A rule that names a project in another organisation is refused" */
  describe("when the rule is validated", () => {
    it("is refused with a named error", async () => {
      await expect(
        service.assertValid({ rule: foreignRule, organizationId: "org_a" }),
      ).rejects.toBeInstanceOf(AggregateRuleOutsideOrganizationError);
    });

    it("is refused the same way for a department of another organisation", async () => {
      await expect(
        service.assertValid({
          rule: { kind: "personal-by-department", departmentId: "dep_foreign" },
          organizationId: "org_a",
        }),
      ).rejects.toMatchObject({ code: "aggregate_rule_outside_organization" });
    });
  });

  /** @scenario "A rule that names a project in another organisation is refused" */
  describe("when an aggregate project is created with it", () => {
    it("writes no team, no project and no grant", async () => {
      const repo = {
        findActiveTeamInOrganization: vi
          .fn()
          .mockResolvedValue({ id: "team_a", isPersonal: false }),
        createTeam: vi.fn(),
        createTeamWithRoleBinding: vi.fn(),
        findBySlugInTeam: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      } as unknown as ProjectRepository;
      const projects = new ProjectService(repo, undefined, service);

      await expect(
        projects.create({
          organizationId: "org_a",
          newTeamName: "Leadership",
          userId: "user_admin",
          name: "Company view",
          language: "other",
          framework: "other",
          kind: AGGREGATE_PROJECT_KIND,
          aggregateRule: foreignRule,
        }),
      ).rejects.toBeInstanceOf(AggregateRuleOutsideOrganizationError);

      expect(repo.createTeam).not.toHaveBeenCalled();
      expect(repo.createTeamWithRoleBinding).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});

describe("given a valid rule", () => {
  describe("when its members are resolved", () => {
    it("reads every personal project of the organisation for all-personal", async () => {
      expect(
        await service.membersOf({
          rule: AGGREGATE_DEFAULT_RULE,
          organizationId: "org_a",
        }),
      ).toEqual(["p_eng", "p_sales"]);
    });

    it("reads only the department's personal projects for a department rule", async () => {
      expect(
        await service.membersOf({
          rule: { kind: "personal-by-department", departmentId: "dep_eng" },
          organizationId: "org_a",
        }),
      ).toEqual(["p_eng"]);
    });

    it("reads exactly the named projects, personal or not, for an explicit rule", async () => {
      expect(
        await service.membersOf({
          rule: { kind: "explicit", projectIds: ["p_team", "p_sales"] },
          organizationId: "org_a",
        }),
      ).toEqual(["p_sales", "p_team"]);
    });

    it("never counts the aggregate as its own member", async () => {
      expect(
        await service.membersOf({
          rule: { kind: "explicit", projectIds: ["p_team", "p_eng"] },
          organizationId: "org_a",
          aggregateProjectId: "p_team",
        }),
      ).toEqual(["p_eng"]);
    });

    it("drops a named project that is no longer readable instead of failing", async () => {
      expect(
        await service.membersOf({
          rule: { kind: "explicit", projectIds: ["p_team", "p_gov"] },
          organizationId: "org_a",
        }),
      ).toEqual(["p_team"]);
    });
  });
});
