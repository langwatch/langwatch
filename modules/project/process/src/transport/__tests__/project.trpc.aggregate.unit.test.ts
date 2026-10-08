/**
 * @vitest-environment node
 * ADR-175 through `project.*` over the app `ProjectModule.create` builds. AuthZ says
 * yes to everyone but the outsider, so any other refusal is the aggregate rule's.
 * @see specs/governance/aggregate-project.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import {
  MemberNotFoundError,
  TeamNotFoundError,
  type OrganizationApi,
} from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import {
  AGGREGATE_DEFAULT_RULE,
  PROJECT_KIND,
  projectSchema,
  type Project,
  type Team,
} from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { fromDate } from "@langwatch/time";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { ProjectModule } from "../../app/project.app.ts";
import { MemoryAggregateRuleRepository } from "../../repositories/memory/memory.aggregate-rule.repository.ts";
import { MemoryProjectStorageSettingsRepository } from "../../repositories/memory/memory.project-storage-settings.repository.ts";
import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { projectTrpcTransport, type ProjectBrowserApi } from "../project.trpc.ts";
import type { ProjectTrpcTestContext } from "./project.trpc.harness.ts";

const ORG = "org_a";
const ADMIN = "u_admin";
const MEMBER = "u_member";
const OUTSIDER = "u_outsider";
const NOW = new Date("2026-10-06T00:00:00.000Z");

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: id,
    slug: id,
    organizationId: ORG,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
    ...overrides,
  };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return projectSchema.parse({
    id,
    name: id,
    slug: id,
    apiKey: `key-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId: "team_a",
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

const ROLES: Record<string, string> = { [ADMIN]: "ADMIN", [MEMBER]: "MEMBER" };

function mount(actorId: string) {
  const database = MemoryProjectDatabase.create();
  database.putTeam(team("team_a"));
  database.putTeam(team("team_eng", { isPersonal: true, ownerUserId: "u_eng" }));
  database.putProject(project("p_shared"));
  database.putProject(
    project("p_eng", { teamId: "team_eng", isPersonal: true, ownerUserId: "u_eng" }),
  );
  database.putProject(project("p_gov", { kind: PROJECT_KIND.INTERNAL_GOVERNANCE }));

  const organizations = createApiFixture<OrganizationApi>({
    getMember: async ({ organizationId, userId }) => {
      const role = organizationId === ORG ? ROLES[userId] : void 0;
      if (!role) throw new MemberNotFoundError(userId);
      return {
        userId,
        organizationId,
        role,
        disabledAt: null,
        createdAt: fromDate(NOW),
        updatedAt: fromDate(NOW),
        user: { id: userId, name: userId, email: null },
        teams: [],
      };
    },
    getTeam: async ({ teamId }) => {
      const found = database.findTeam(teamId);
      if (!found) throw new TeamNotFoundError(teamId);
      return found;
    },
    findMembersWithDepartments: async () => [
      { userId: "u_eng", departmentId: "dep_eng", user: { name: "Eng", email: "eng@acme.test" } },
    ],
  });
  // An outsider holds no organisation permission; everyone else holds every one.
  const authorization = createApiFixture<AuthzApi>({
    hasPermission: async ({ userId }) => userId !== OUTSIDER,
  });

  const app = ProjectModule.create({
    logger: { error: () => void 0 },
    dependencies: {
      authorization,
      organizations,
      auditLog: createApiFixture<AuditLogApi>({}, "auditLog"),
      dataPrivacy: createApiFixture<DataPrivacyApi>({}, "dataPrivacy"),
    },
    repositories: {
      projects: MemoryProjectRepository.create({ memory: database }),
      storageSettings: MemoryProjectStorageSettingsRepository.create({ memory: database }),
      aggregateRules: MemoryAggregateRuleRepository.create({ memory: database }),
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
  app.connectLifecycle({
    recordProjectCreated: { send: async () => undefined },
    recordProjectLegacyKeyRevoked: { send: async () => undefined },
    recordPresenceSettingChanged: { send: async () => undefined },
    recordProjectMoved: { send: async () => undefined },
    recordProjectArchived: { send: async () => undefined },
    recordProjectDepartmentAssigned: { send: async () => undefined },
    recordProjectTraceSharingDisabled: { send: async () => undefined },
  });

  const browser: ProjectBrowserApi = {
    projects: () => app.projects(),
    probePermission: (input) => app.probePermission(input),
    archiveOtherProject: (input) => app.archiveOtherProject(input),
    revokeProjectApiKey: (input) => app.revokeProjectApiKey(input),
    getLegacyKeyStatus: (input) => app.getLegacyKeyStatus(input),
    assertMayCreateAggregate: (input) => app.assertMayCreateAggregate(input),
    aggregateMemberCandidates: (input) => app.aggregateMemberCandidates(input),
  };
  const trpc = initTRPC.context<ProjectTrpcTestContext>().create();
  const router = createTrpcRuntime<ProjectTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<ProjectTrpcTestContext>(),
  }).mount(projectTrpcTransport, () => browser);

  return { app, database, caller: router.createCaller({ actor: { id: actorId } }) };
}

const aggregateInput = {
  organizationId: ORG,
  teamId: "team_a",
  name: "Company view",
  language: "other",
  framework: "other",
  kind: PROJECT_KIND.AGGREGATE,
} as const;

describe("Feature: an admin creates an aggregate project", () => {
  describe("when the admin creates a project of kind aggregate without a rule", () => {
    /** @scenario "An admin creates an aggregate project from the new-project flow" */
    it("stores the all-personal rule and attaches the project to the chosen team", async () => {
      const { caller, database } = mount(ADMIN);

      const { projectSlug } = await caller.create(aggregateInput);

      expect(database.projects().find((row) => row.slug === projectSlug)).toMatchObject({
        kind: PROJECT_KIND.AGGREGATE,
        aggregateRule: AGGREGATE_DEFAULT_RULE,
        teamId: "team_a",
      });
    });
  });

  describe("when a member who is not an admin asks to create one on their own team", () => {
    /** @scenario "A member who is not an admin is refused when creating an aggregate project" */
    it("is refused as admin only with a 403 and nothing is written", async () => {
      const { caller, database } = mount(MEMBER);
      const before = database.projects().length;

      await expect(caller.create(aggregateInput)).rejects.toMatchObject({
        cause: { code: "aggregate_project_admin_only", httpStatus: 403 },
      });
      expect(database.projects()).toHaveLength(before);
    });
  });

  describe("when someone outside the organisation asks to create one", () => {
    it("keeps the shared permission refusal, not the admin-only one, and writes nothing", async () => {
      const { caller, database } = mount(OUTSIDER);
      const before = database.projects().length;

      await expect(caller.create(aggregateInput)).rejects.toMatchObject({
        cause: { code: "permission_denied" },
      });
      expect(database.projects()).toHaveLength(before);
    });
  });

  describe("when the admin names an explicit list of two listed projects", () => {
    /** @scenario "An admin picks specific projects from a dropdown" */
    it("stores an explicit rule naming exactly those two", async () => {
      const { caller, database } = mount(ADMIN);
      const picked = ["p_eng", "p_shared"];

      const { projectSlug } = await caller.create({
        ...aggregateInput,
        aggregateRule: { kind: "explicit", projectIds: picked },
      });

      expect(database.projects().find((row) => row.slug === projectSlug)?.aggregateRule).toEqual({
        kind: "explicit",
        projectIds: picked,
      });
    });

    it("refuses a list that names the hidden governance project and writes nothing", async () => {
      const { caller, database } = mount(ADMIN);
      const before = database.projects().length;

      await expect(
        caller.create({
          ...aggregateInput,
          aggregateRule: { kind: "explicit", projectIds: ["p_shared", "p_gov"] },
        }),
      ).rejects.toMatchObject({ cause: { code: "aggregate_rule_outside_organization" } });
      expect(database.projects()).toHaveLength(before);
    });
  });
});

describe("Feature: an admin picks the projects a new aggregate reads", () => {
  /** @scenario "The admin sees every member's personal workspace under Personal projects" */
  it("lists the personal workspace with its owner to an admin", async () => {
    const { caller } = mount(ADMIN);

    const candidates = await caller.aggregateMemberCandidates({ organizationId: ORG });

    expect(candidates).toEqual([
      {
        id: "p_eng",
        name: "p_eng",
        isPersonal: true,
        owner: { name: "Eng", email: "eng@acme.test" },
      },
      { id: "p_shared", name: "p_shared", isPersonal: false, owner: null },
    ]);
  });

  /** @scenario "The admin sees every member's personal workspace under Personal projects" */
  it("refuses a member who is not an admin", async () => {
    const { caller } = mount(MEMBER);

    await expect(caller.aggregateMemberCandidates({ organizationId: ORG })).rejects.toMatchObject({
      cause: { code: "aggregate_project_admin_only" },
    });
  });
});

describe("Feature: the aggregate Trace Explorer skips onboarding", () => {
  /** @scenario "Aggregate Trace Explorer shows member rows without onboarding" */
  it("answers that the aggregate has traces though none was sent to it", async () => {
    const { caller, database } = mount(ADMIN);
    database.putProject(project("p_agg", { kind: PROJECT_KIND.AGGREGATE }));

    await expect(caller.getHasFirstMessage({ projectId: "p_agg" })).resolves.toEqual({
      firstMessage: true,
    });
    await expect(caller.getHasFirstMessage({ projectId: "p_shared" })).resolves.toEqual({
      firstMessage: false,
    });
  });
});

describe("Feature: the aggregate project is no place to send traces", () => {
  it("never resolves a key's traces to the aggregate, named or as the only project", async () => {
    const { app, database } = mount(ADMIN);
    database.putProject(project("p_agg", { kind: PROJECT_KIND.AGGREGATE }));

    const named = await app.resolveTraceDestination({
      organizationId: ORG,
      projectScopeIds: [],
      traceProjectId: "p_agg",
    });
    const scoped = await app.resolveTraceDestination({
      organizationId: ORG,
      projectScopeIds: ["p_agg"],
    });

    expect(named.outcome).not.toBe("resolved");
    expect(scoped.outcome).not.toBe("resolved");
  });
});

describe("Feature: aggregates are listed only to organisation admins", () => {
  const page = { organizationId: ORG, page: 1, limit: 50 } as const;

  function listedIds(listed: { data: { id: string }[] }): string[] {
    return listed.data.map((row) => row.id).toSorted();
  }

  it("lists the aggregate to an admin credential owner", async () => {
    const { app, database } = mount(ADMIN);
    database.putProject(project("p_agg", { kind: PROJECT_KIND.AGGREGATE }));

    const listed = await app.listByOrganization({
      ...page,
      aggregatesVisibleTo: { userId: ADMIN },
    });

    expect(listedIds(listed)).toEqual(["p_agg", "p_eng", "p_shared"]);
  });

  it("leaves it out for a member, an outsider and a key that acts for nobody", async () => {
    const { app, database } = mount(ADMIN);
    database.putProject(project("p_agg", { kind: PROJECT_KIND.AGGREGATE }));

    for (const userId of [MEMBER, OUTSIDER, null]) {
      const listed = await app.listByOrganization({ ...page, aggregatesVisibleTo: { userId } });
      expect(listedIds(listed)).toEqual(["p_eng", "p_shared"]);
    }
  });

  it("keeps an internal listing that names no caller as it was", async () => {
    const { app, database } = mount(ADMIN);
    database.putProject(project("p_agg", { kind: PROJECT_KIND.AGGREGATE }));

    expect(listedIds(await app.listByOrganization(page))).toEqual(["p_agg", "p_eng", "p_shared"]);
  });
});
