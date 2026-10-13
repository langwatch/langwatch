/**
 * @vitest-environment node
 * Main's aggregate create, rule edit and member-candidate checks on memory twins (ADR-177).
 */
import {
  AggregateProjectAdminOnlyError,
  AggregateRuleOutsideOrganizationError,
  PROJECT_KIND,
  ProjectNotFoundError,
  type Project,
  type Team,
} from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { AggregateProjectService } from "../aggregate-project.service.ts";

const at = new Date("2026-01-01T00:00:00.000Z");
const ORG = "org_acme";

function team(id: string, organizationId = ORG): Team {
  return {
    id,
    name: id,
    slug: id,
    organizationId,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  };
}

function project(input: Partial<Project> & { id: string; teamId: string }): Project {
  return {
    name: input.id,
    slug: input.id,
    apiKey: `sk-${input.id}`,
    lwqlKey: `lwql-${input.id}`,
    language: "other",
    framework: "other",
    kind: PROJECT_KIND.APPLICATION,
    firstMessage: false,
    integrated: false,
    createdAt: at,
    updatedAt: at,
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
    personalFeatures: {},
    departmentId: null,
    aggregateRule: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...input,
  };
}

function setup({ role }: { role: string | null }) {
  const memory = MemoryProjectDatabase.create();
  memory.putTeam(team("team-a"));
  memory.putTeam(team("team-other", "org_other"));
  memory.putProject(
    project({ id: "personal-1", teamId: "team-a", isPersonal: true, ownerUserId: "u1" }),
  );
  memory.putProject(
    project({ id: "personal-2", teamId: "team-a", isPersonal: true, ownerUserId: "u2" }),
  );
  memory.putProject(project({ id: "shared", teamId: "team-a" }));
  memory.putProject(project({ id: "elsewhere", teamId: "team-other" }));
  memory.putProject(
    project({
      id: "agg",
      teamId: "team-a",
      kind: PROJECT_KIND.AGGREGATE,
      aggregateRule: { kind: "all-personal" },
    }),
  );
  const changes: string[] = [];
  const service = AggregateProjectService.create({
    repository: MemoryProjectRepository.create({ memory }),
    organizations: {
      isMember: async () => role !== null,
      getMember: async () => {
        if (role === null) throw new Error("not a member");
        return {
          userId: admin.id,
          organizationId: ORG,
          role,
          disabledAt: null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
          user: { id: admin.id, name: null, email: null },
          teams: [],
        };
      },
    },
    lifecycle: { aggregateRuleChanged: async ({ projectId }) => void changes.push(projectId) },
  });
  return { service, changes, memory, repository: MemoryProjectRepository.create({ memory }) };
}

const admin = { id: "u-admin" };

describe("AggregateProjectService", () => {
  it("writes no kind columns for an ordinary project", async () => {
    const { service } = setup({ role: "MEMBER" });
    await expect(
      service.createFields({ organizationId: ORG, kind: "application", by: admin }),
    ).resolves.toEqual({});
  });

  it("defaults a new aggregate to the all-personal rule for an organisation admin", async () => {
    const { service } = setup({ role: "ADMIN" });
    await expect(
      service.createFields({ organizationId: ORG, kind: "aggregate", by: admin }),
    ).resolves.toEqual({ kind: "aggregate", aggregateRule: { kind: "all-personal" } });
  });

  it("refuses an aggregate to anyone but an organisation admin", async () => {
    const { service } = setup({ role: "MEMBER" });
    await expect(
      service.createFields({ organizationId: ORG, kind: "aggregate", by: admin }),
    ).rejects.toBeInstanceOf(AggregateProjectAdminOnlyError);
  });

  /** @scenario "A rule that names a project in another organisation is refused" */
  it("refuses an explicit rule naming a project of another organisation or an aggregate", async () => {
    const { service, changes } = setup({ role: "ADMIN" });
    for (const projectIds of [["elsewhere"], ["agg"], ["shared", "missing"]]) {
      await expect(
        service.createFields({
          organizationId: ORG,
          kind: "aggregate",
          aggregateRule: { kind: "explicit", projectIds },
          by: admin,
        }),
      ).rejects.toBeInstanceOf(AggregateRuleOutsideOrganizationError);
    }
    expect(changes).toEqual([]);
  });

  it("replaces a live aggregate's rule, records the change and answers its members pending", async () => {
    const { service, changes, memory } = setup({ role: "ADMIN" });
    const members = await service.updateRule({
      projectId: "agg",
      aggregateRule: { kind: "explicit", projectIds: ["shared", "personal-1"] },
      by: admin,
    });
    expect(members).toEqual({
      attached: [],
      revoked: [],
      unchanged: [],
      failed: [],
      pending: ["personal-1", "shared"],
    });
    expect(changes).toEqual(["agg"]);
    expect(memory.findProject("agg")?.aggregateRule).toEqual({
      kind: "explicit",
      projectIds: ["shared", "personal-1"],
    });
  });

  it("answers not found when the rule edit names a project that is not an aggregate", async () => {
    const { service } = setup({ role: "ADMIN" });
    await expect(
      service.updateRule({
        projectId: "shared",
        aggregateRule: { kind: "all-personal" },
        by: admin,
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("lists candidates to admins only, never an aggregate nor another organisation's project", async () => {
    const { service } = setup({ role: "ADMIN" });
    const candidates = await service.candidateMembers({ organizationId: ORG, by: admin });
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "personal-1",
      "personal-2",
      "shared",
    ]);
    await expect(
      setup({ role: null }).service.candidateMembers({ organizationId: ORG, by: admin }),
    ).rejects.toBeInstanceOf(AggregateProjectAdminOnlyError);
  });

  it("reads the aggregate and the personal projects governance reconciles from", async () => {
    const { repository } = setup({ role: "ADMIN" });
    await expect(repository.findAggregate({ aggregateProjectId: "agg" })).resolves.toEqual([
      { id: "agg", organizationId: ORG, archived: false, rule: { kind: "all-personal" } },
    ]);
    await expect(repository.findAggregate({ aggregateProjectId: "shared" })).resolves.toEqual([]);
    await expect(repository.findAllLiveAggregates()).resolves.toEqual([
      { id: "agg", organizationId: ORG },
    ]);
    await expect(
      repository.findPersonalProjectIds({ organizationId: ORG, ownerUserIds: ["u2"] }),
    ).resolves.toEqual(["personal-2"]);
  });
});
