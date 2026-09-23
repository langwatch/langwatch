import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * The `project.*` namespace against the composition-built app — same defect
 * as `project.trpc.unit.test.ts`, whose seven `vi.fn` mounts stay green while
 * every procedure throws. Spec: specs/projects/projects-browser-door.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { LocalFeatureApis, ResourceScope } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi, type Project, type ProjectWithTeam } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi, type TopicClusteringStatus } from "@langwatch/topic-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectApp } from "../../app/project.app.ts";
import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import type { ProjectHomeApi } from "../home.trpc.ts";
import type { IntegrationsChecksApi } from "../integrations-checks.trpc.ts";
import type { ProjectBrowserApi } from "../project.trpc.ts";
import { projectTrpcTransport } from "../project.trpc.ts";
import { projectTrpcTestMembers, type ProjectTrpcTestContext } from "./project.trpc.harness.ts";
import { TestApiKeyService } from "./support/test-api-key-service.ts";

const ACTOR_ID = "user-1";
const ORGANIZATION_ID = "organization-1";
const OTHER_PROJECT_ID = "project_other";
const NOW = new Date("2026-09-01T00:00:00.000Z");

/**
 * Which members of the browser witness the app answers today. `Record<keyof
 * …>` forces a new member to be classified here; the three `false` entries
 * are other verticals' — see `.claude/handoffs/project-trpc-witness-alignment.md`.
 */
const BROWSER_MEMBERS_SERVED: Record<keyof ProjectBrowserApi, boolean> = {
  projects: true,
  encryptProjectSecret: true,
  probePermission: true,
  reportTopicClusteringFailure: true,
  /** The trace module's `resolveViewerProtections`. */
  getFieldProtections: false,
  /** The Langy gateway's virtual-key mint. */
  provisionLangyVirtualKey: false,
  /** The audit-log module's `record`. */
  recordApiKeyRegenerated: false,
};

/** The home strip reads the audit trail and five other verticals' rows. */
const HOME_MEMBERS_SERVED: Record<keyof ProjectHomeApi, boolean> = {
  getRecentItems: false,
};

/** The setup checklist counts nine verticals' rows. */
const CHECKS_MEMBERS_SERVED: Record<keyof IntegrationsChecksApi, boolean> = {
  getCheckStatus: false,
};

function team(overrides: Partial<ProjectWithTeam["team"]> = {}): ProjectWithTeam["team"] {
  return {
    id: "team-1",
    name: "Team",
    slug: "team",
    organizationId: ORGANIZATION_ID,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project_1",
    name: "First Project",
    slug: "first-project",
    apiKey: "sk-lw-base-key-of-the-project",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "python",
    framework: "langchain",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: NOW,
    updatedAt: NOW,
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

/** A project whose topics have never been clustered: nothing is in flight. */
const IDLE_CLUSTERING: TopicClusteringStatus = {
  lastRequestedAt: null,
  lastRequestTrigger: null,
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunMode: null,
  lastRunSkippedReason: null,
  lastRunErrorCode: null,
  isLastRunErrorUserActionable: false,
  lastRunTracesProcessed: 0,
  lastRunTopicsCount: 0,
  lastRunSubtopicsCount: 0,
  isInProgress: false,
  isRunInFlight: false,
  nextRunAt: null,
};

/** One permission question, as this application asked AuthZ. */
type PermissionQuestion = {
  userId: string;
  permission: string;
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

/**
 * The application exactly as `ProjectApp.create` builds it at boot: its own
 * repository over an in-memory backing, the peers it declares, and the two
 * process members it reads.
 */
function application(
  options: {
    permits?: (question: PermissionQuestion) => boolean;
    clustering?: () => Promise<void>;
  } = {},
) {
  const database = MemoryProjectDatabase.create();
  database.putTeam(team());
  database.putProject(project());
  database.putProject(
    project({ id: OTHER_PROJECT_ID, name: "Another Project", slug: "another-project" }),
  );

  const asked: PermissionQuestion[] = [];
  const permits = options.permits ?? (() => true);
  const authorization = createApiFixture<AuthzApi>({
    hasPermission: async (question: PermissionQuestion) => {
      asked.push(question);
      return permits(question);
    },
  });

  const logged: { payload: Readonly<Record<string, unknown>>; message: string }[] = [];
  const app = ProjectApp.create({
    dependencies: {
      apiKeys: Object.assign(new TestApiKeyService(), {
        regenerateLegacyProjectKey: vi.fn(async () => "sk-lw-rotated"),
      }),
      authorization,
      organizations: createApiFixture<OrganizationApi>({}, "organizations"),
      share: createApiFixture<ShareApi>({}, "share"),
      topics: createApiFixture<TopicApi>({
        getClusteringStatus: async () => IDLE_CLUSTERING,
      }),
    },
    repositories: { projects: MemoryProjectRepository.create({ memory: database }) },
    members: {
      topicClustering: {
        requestClustering: options.clustering ?? (async () => undefined),
      },
      now: () => NOW.getTime(),
      // The deployment's cipher, named so the assertion can see it was the one
      // the procedure reached rather than any encryption at all.
      encryption: { encrypt: (plaintext) => `cipher(${plaintext})` },
      logger: {
        error: (payload, message) => {
          logged.push({ payload, message });
        },
      },
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, database, asked, logged };
}

/**
 * The object boot hands every one of this module's transports: the app bound
 * to the module's own API token, through the operations-only proxy — it is
 * the proxy, not the class, that decides whether a member access throws.
 */
function provided(app: ProjectApp) {
  const apis = new LocalFeatureApis();
  apis.declare(ProjectApi);
  apis.bind(ProjectApi, app);
  apis.ready();

  return apis.reference(ProjectApi);
}

/**
 * The `project.*` namespace on a real tRPC root, over the real application.
 * The three members no installed peer answers are supplied here, explicitly,
 * because the mount refuses a partial witness — everything else is the app's own answer.
 */
function mount(options: Parameters<typeof application>[0] = {}) {
  const built = application(options);
  const { app } = built;

  const getFieldProtections = vi.fn(async () => ({}));
  const provisionLangyVirtualKey = vi.fn(async () => {});
  const recordApiKeyRegenerated = vi.fn(async () => {});

  const browser: ProjectBrowserApi = {
    projects: () => app.projects(),
    encryptProjectSecret: (value) => app.encryptProjectSecret(value),
    probePermission: (input) => app.probePermission(input),
    reportTopicClusteringFailure: (error, context) =>
      app.reportTopicClusteringFailure(error, context),
    getFieldProtections,
    provisionLangyVirtualKey,
    recordApiKeyRegenerated,
  };

  const trpc = initTRPC.context<ProjectTrpcTestContext>().create();
  const router = createTrpcRuntime<ProjectTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: projectTrpcTestMembers(),
  }).mount(projectTrpcTransport, () => browser);

  return { ...built, caller: router.createCaller({ actor: { id: ACTOR_ID } }) };
}

describe("given the application the composition builds", () => {
  describe("when a mounted door reaches it through the feature-API proxy", () => {
    /** @scenario "a mounted door reaches only members the application serves" */
    it("serves each browser member the map names, and refuses the rest by name", () => {
      const reference = provided(application().app);

      for (const [member, served] of Object.entries(BROWSER_MEMBERS_SERVED)) {
        if (served) {
          expect(typeof Reflect.get(reference, member)).toBe("function");
          continue;
        }

        expect(() => Reflect.get(reference, member)).toThrow(
          `exposes operations only: ${member} is not callable`,
        );
      }
    });

    it("refuses the home and setup-checklist members no installed peer answers", () => {
      const reference = provided(application().app);
      const unserved = [
        ...Object.keys(HOME_MEMBERS_SERVED).filter(
          (member) => !HOME_MEMBERS_SERVED[member as keyof ProjectHomeApi],
        ),
        ...Object.keys(CHECKS_MEMBERS_SERVED).filter(
          (member) => !CHECKS_MEMBERS_SERVED[member as keyof IntegrationsChecksApi],
        ),
      ];

      for (const member of unserved) {
        expect(() => Reflect.get(reference, member)).toThrow(
          `exposes operations only: ${member} is not callable`,
        );
      }
    });
  });
});

describe("the project tRPC namespace over the application the composition builds", () => {
  describe("when the base key is read", () => {
    /** @scenario "the browser door reads the project the composition built" */
    it("answers with the project its own repository holds", async () => {
      const { caller } = mount();

      await expect(caller.getProjectAPIKey({ projectId: "project_1" })).resolves.toMatchObject({
        id: "project_1",
        apiKey: "sk-lw-base-key-of-the-project",
      });
    });
  });

  describe("when the settings form carries stored-object credentials", () => {
    /** @scenario "stored-object credentials are written through the deployment's cipher" */
    it("writes each one through the process's own encryption member", async () => {
      const { caller, database } = mount();

      await caller.update({
        projectId: "project_1",
        name: "First Project",
        traceSharingEnabled: false,
        presenceEnabled: false,
        s3Endpoint: "https://s3.example",
        s3AccessKeyId: "access-key",
        s3SecretAccessKey: "secret-key",
        s3Bucket: "bucket",
      });

      expect(database.findProject("project_1")).toMatchObject({
        s3Endpoint: "cipher(https://s3.example)",
        s3AccessKeyId: "cipher(access-key)",
        s3SecretAccessKey: "cipher(secret-key)",
      });
    });
  });

  describe("when trace sharing is flipped", () => {
    /** @scenario "flipping trace sharing asks the caller's own standing" */
    it("asks AuthZ about the caller at the project, and refuses when it says no", async () => {
      const { caller, asked, database } = mount({
        permits: (question) => question.permission !== "project:manage",
      });

      await expect(
        caller.update({ projectId: "project_1", name: "First Project", traceSharingEnabled: true }),
      ).rejects.toMatchObject({ cause: { code: "permission_denied", httpStatus: 403 } });

      expect(asked).toContainEqual({
        userId: ACTOR_ID,
        permission: "project:manage",
        projectId: "project_1",
      });
      expect(database.findProject("project_1")?.traceSharingEnabled).toBe(false);
    });
  });

  describe("when another project is archived", () => {
    /** @scenario "archiving another project is probed on that project" */
    it("asks AuthZ about the caller at the OTHER project before archiving it", async () => {
      const { caller, asked, database } = mount();

      await expect(
        caller.archiveById({ projectId: "project_1", projectToArchiveId: OTHER_PROJECT_ID }),
      ).resolves.toEqual({ success: true, alreadyArchived: false });

      expect(asked).toContainEqual({
        userId: ACTOR_ID,
        permission: "project:delete",
        projectId: OTHER_PROJECT_ID,
      });
      expect(database.findProject(OTHER_PROJECT_ID)?.archivedAt).not.toBeNull();
    });

    it("refuses, and archives nothing, when AuthZ denies the other project", async () => {
      const { caller, database } = mount({
        permits: (question) => question.projectId !== OTHER_PROJECT_ID,
      });

      await expect(
        caller.archiveById({ projectId: "project_1", projectToArchiveId: OTHER_PROJECT_ID }),
      ).rejects.toMatchObject({ cause: { code: "project_permission_denied", httpStatus: 403 } });

      expect(database.findProject(OTHER_PROJECT_ID)?.archivedAt).toBeNull();
    });
  });

  describe("when a clustering request does not land", () => {
    /** @scenario "a clustering request that fails is reported, not raised" */
    it("reports it through the process's logger and answers with an unknown failure", async () => {
      const { caller, logged } = mount({
        clustering: async () => {
          throw new Error("the scheduler is not reachable");
        },
      });

      await expect(caller.triggerTopicClustering({ projectId: "project_1" })).rejects.toBeDefined();

      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ payload: { projectId: "project_1" } });
    });
  });
});
