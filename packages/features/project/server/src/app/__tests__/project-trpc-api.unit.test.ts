/**
 * @vitest-environment node
 */
import { ApiKeyNotFoundError, type ApiKeyApi } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectApi,
  type Project,
  type ProjectWithTeam,
  ProjectService,
} from "@langwatch/project-contract";
import { ProjectOperationsService } from "../../services/project-operations.service.ts";
import type { ShareApi } from "@langwatch/share-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectTrpcApi } from "../../transport/api-trpc/project.api.ts";

type TestContext = {
  app: { projects: ProjectApi };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

/**
 * The refusal a process raises when it composed no clustering scheduler — the API process is
 * the deployment that does.
 */
class NoClusteringSchedulerError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "This deployment has no topic-clustering scheduler.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "NoClusteringSchedulerError";
  }
}

type ProjectOperationsOverrides = {
  tryGetWithTeam?: ProjectService["tryGetWithTeam"];
  update?: ProjectService["update"];
};

/** A typed service double for the two application orchestration seams under characterization. */
class CharacterizationProjectService extends ProjectService {
  listPaths(): Promise<never> {
    return this.unimplemented("listPaths");
  }
  constructor(private readonly overrides: ProjectOperationsOverrides) {
    super();
  }

  tryGetWithTeam: ProjectService["tryGetWithTeam"] = (id) =>
    this.overrides.tryGetWithTeam?.(id) ?? Promise.resolve(null);
  update: ProjectService["update"] = (input) =>
    this.overrides.update?.(input) ?? this.unimplemented("update");

  tryFindInternal: ProjectService["tryFindInternal"] = () => this.unimplemented("tryFindInternal");
  ensureInternal: ProjectService["ensureInternal"] = () => this.unimplemented("ensureInternal");
  isPresenceEnabled: ProjectService["isPresenceEnabled"] = () =>
    this.unimplemented("isPresenceEnabled");
  getById: ProjectService["getById"] = () => this.unimplemented("getById");
  tryGetIdentity: ProjectService["tryGetIdentity"] = () => this.unimplemented("tryGetIdentity");
  getOrganizationId: ProjectService["getOrganizationId"] = () =>
    this.unimplemented("getOrganizationId");
  tryGetOrganizationId: ProjectService["tryGetOrganizationId"] = () =>
    this.unimplemented("tryGetOrganizationId");
  tryGetById: ProjectService["tryGetById"] = () => this.unimplemented("tryGetById");
  tryGetSummaryById: ProjectService["tryGetSummaryById"] = () =>
    this.unimplemented("tryGetSummaryById");
  getWithTeam: ProjectService["getWithTeam"] = () => this.unimplemented("getWithTeam");
  create: ProjectService["create"] = () => this.unimplemented("create");
  archive: ProjectService["archive"] = () => this.unimplemented("archive");
  listByOrganization: ProjectService["listByOrganization"] = () =>
    this.unimplemented("listByOrganization");
  listByTeam: ProjectService["listByTeam"] = () => this.unimplemented("listByTeam");
  listNamesByIds: ProjectService["listNamesByIds"] = () => this.unimplemented("listNamesByIds");
  listIdsByOrganization: ProjectService["listIdsByOrganization"] = () =>
    this.unimplemented("listIdsByOrganization");
  listActiveByScopes: ProjectService["listActiveByScopes"] = () =>
    this.unimplemented("listActiveByScopes");
  updateMetadata: ProjectService["updateMetadata"] = () => this.unimplemented("updateMetadata");
  touchCodingAgentSessionSeen: ProjectService["touchCodingAgentSessionSeen"] = () =>
    this.unimplemented("touchCodingAgentSessionSeen");
  touchCodingAgentPullRequestSeen: ProjectService["touchCodingAgentPullRequestSeen"] = () =>
    this.unimplemented("touchCodingAgentPullRequestSeen");
  searchByQuery: ProjectService["searchByQuery"] = () => this.unimplemented("searchByQuery");
  tryGetTraceSharingConfig: ProjectService["tryGetTraceSharingConfig"] = () =>
    this.unimplemented("tryGetTraceSharingConfig");
  resolveOrgAdmin: ProjectService["resolveOrgAdmin"] = () => this.unimplemented("resolveOrgAdmin");
  resolveTraceDestination: ProjectService["resolveTraceDestination"] = () =>
    this.unimplemented("resolveTraceDestination");
  tryGetTraceDestination: ProjectService["tryGetTraceDestination"] = () =>
    this.unimplemented("tryGetTraceDestination");
  listTraceDestinations: ProjectService["listTraceDestinations"] = () =>
    this.unimplemented("listTraceDestinations");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(
      new Error(`CharacterizationProjectService does not implement ${operation}`),
    );
  }
}

class CharacterizationShareApi implements ShareApi {
  readonly revokeAllTraceShares: ShareApi["revokeAllTraceShares"];

  constructor(revoke: ShareApi["revokeAllTraceShares"]) {
    this.revokeAllTraceShares = revoke;
  }
  listForResource: ShareApi["listForResource"] = () => this.unimplemented();
  resolveForViewer: ShareApi["resolveForViewer"] = () => this.unimplemented();
  createShare: ShareApi["createShare"] = () => this.unimplemented();
  revokeById: ShareApi["revokeById"] = () => this.unimplemented();
  unshare: ShareApi["unshare"] = () => this.unimplemented();
  pinTrace: ShareApi["pinTrace"] = () => this.unimplemented();
  unpinTrace: ShareApi["unpinTrace"] = () => this.unimplemented();
  findTracePin: ShareApi["findTracePin"] = () => this.unimplemented();
  listTracePins: ShareApi["listTracePins"] = () => this.unimplemented();
  findCachedPayload: ShareApi["findCachedPayload"] = () => this.unimplemented();
  cachePayload: ShareApi["cachePayload"] = () => this.unimplemented();

  private unimplemented(): Promise<never> {
    return Promise.reject(new Error("CharacterizationShareApi operation is not configured"));
  }
}

class CharacterizationApiKeyApi implements ApiKeyApi {
  create: ApiKeyApi["create"] = () => this.unimplemented();
  update: ApiKeyApi["update"] = () => this.unimplemented();
  findVerifiedToken: ApiKeyApi["findVerifiedToken"] = () => this.unimplemented();
  findResolvedToken: ApiKeyApi["findResolvedToken"] = () => this.unimplemented();
  regenerateLegacyProjectKey: ApiKeyApi["regenerateLegacyProjectKey"] = () => this.unimplemented();
  resolveOrganizationToken: ApiKeyApi["resolveOrganizationToken"] = () => this.unimplemented();
  resolveVisibleProjects: ApiKeyApi["resolveVisibleProjects"] = () => this.unimplemented();
  markUsed: ApiKeyApi["markUsed"] = () => undefined;
  list: ApiKeyApi["list"] = () => this.unimplemented();
  listAll: ApiKeyApi["listAll"] = () => this.unimplemented();
  revoke: ApiKeyApi["revoke"] = () => this.unimplemented();
  ensureCallerIsOrgMember: ApiKeyApi["ensureCallerIsOrgMember"] = () => this.unimplemented();
  assertSelectionWithinCeiling: ApiKeyApi["assertSelectionWithinCeiling"] = () =>
    this.unimplemented();
  isOrgAdmin: ApiKeyApi["isOrgAdmin"] = () => this.unimplemented();
  isOrgAdminApiKey: ApiKeyApi["isOrgAdminApiKey"] = () => this.unimplemented();
  findById: ApiKeyApi["findById"] = () => this.unimplemented();
  getByIdForCaller: ApiKeyApi["getByIdForCaller"] = () => this.unimplemented();
  findNameByIdInOrg: ApiKeyApi["findNameByIdInOrg"] = () => this.unimplemented();
  getUserBindings: ApiKeyApi["getUserBindings"] = () => this.unimplemented();
  getOrgProjects: ApiKeyApi["getOrgProjects"] = () => this.unimplemented();
  getOrgTeams: ApiKeyApi["getOrgTeams"] = () => this.unimplemented();
  getOrgMembers: ApiKeyApi["getOrgMembers"] = () => this.unimplemented();
  findIngestionKey: ApiKeyApi["findIngestionKey"] = () => this.unimplemented();
  listIngestionKeysForProject: ApiKeyApi["listIngestionKeysForProject"] = () =>
    this.unimplemented();
  findByLookupId: ApiKeyApi["findByLookupId"] = () => this.unimplemented();
  validateCliSelection: ApiKeyApi["validateCliSelection"] = () => this.unimplemented();
  findDefaultCliSelection: ApiKeyApi["findDefaultCliSelection"] = () => this.unimplemented();
  mintCliLoginKey: ApiKeyApi["mintCliLoginKey"] = () => this.unimplemented();
  revokeCliLoginKeysForDevice: ApiKeyApi["revokeCliLoginKeysForDevice"] = () =>
    this.unimplemented();
  revokeCliLoginKeyForLogout: ApiKeyApi["revokeCliLoginKeyForLogout"] = () => this.unimplemented();
  enrichBindingsWithNames: ApiKeyApi["enrichBindingsWithNames"] = () => this.unimplemented();
  enrichApiKeyList: ApiKeyApi["enrichApiKeyList"] = () => this.unimplemented();
  listCallerBindings: ApiKeyApi["listCallerBindings"] = () => this.unimplemented();
  findKeyName: ApiKeyApi["findKeyName"] = () => this.unimplemented();
  listKeys: ApiKeyApi["listKeys"] = () => this.unimplemented();
  createKey: ApiKeyApi["createKey"] = () => this.unimplemented();
  updateKey: ApiKeyApi["updateKey"] = () => this.unimplemented();
  revokeKey: ApiKeyApi["revokeKey"] = () => this.unimplemented();
  listOrganizationProjects: ApiKeyApi["listOrganizationProjects"] = () => this.unimplemented();
  listOrganizationTeams: ApiKeyApi["listOrganizationTeams"] = () => this.unimplemented();
  listOrganizationMembers: ApiKeyApi["listOrganizationMembers"] = () => this.unimplemented();

  private unimplemented(): Promise<never> {
    return Promise.reject(new Error("CharacterizationApiKeyApi operation is not configured"));
  }
}

class CharacterizationTopicApi implements TopicApi {
  getAll: TopicApi["getAll"] = () => this.unimplemented();
  getNamesByIds: TopicApi["getNamesByIds"] = () => this.unimplemented();
  getClusteringStatus: TopicApi["getClusteringStatus"] = () => this.unimplemented();
  getClusteringRunHistory: TopicApi["getClusteringRunHistory"] = () => this.unimplemented();

  private unimplemented(): Promise<never> {
    return Promise.reject(new Error("CharacterizationTopicApi operation is not configured"));
  }
}

function characterizationProject(traceSharingEnabled: boolean): ProjectWithTeam {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  const project: Project = {
    id: "project_123",
    name: "Project",
    slug: "project",
    apiKey: "sk-lw-test",
    lwqlKey: "lwql-test",
    teamId: "team-1",
    language: "typescript",
    framework: "test",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    userLinkTemplate: null,
    traceSharingEnabled,
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
  };
  return {
    ...project,
    team: {
      id: "team-1",
      name: "Team",
      slug: "team",
      organizationId: "org-1",
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  };
}

function characterizationOperations(options: {
  projects: ProjectOperationsOverrides;
  revokeAllTraceShares: ShareApi["revokeAllTraceShares"];
}): ProjectOperationsService {
  return ProjectOperationsService.create({
    projects: new CharacterizationProjectService(options.projects),
    apiKeys: new CharacterizationApiKeyApi(),
    share: new CharacterizationShareApi(options.revokeAllTraceShares),
    topics: new CharacterizationTopicApi(),
    topicClustering: { requestClustering: async () => {} },
    now: () => 0,
  });
}

/** A complete ProjectApi fake keeps this transport suite at the feature boundary. */
class TestProjectApi implements ProjectApi {
  tryGetOrganizationId(projectId: string) {
    return (
      this.overrides.tryGetOrganizationId?.(projectId) ?? this.unimplemented("tryGetOrganizationId")
    );
  }

  searchByQuery(input: { query: string; organizationId?: string; limit?: number }) {
    return this.overrides.searchByQuery?.(input) ?? this.unimplemented("searchByQuery");
  }

  listNamesByIds(input: { projectIds: string[] }) {
    return this.overrides.listNamesByIds?.(input) ?? this.unimplemented("listNamesByIds");
  }

  listIdsByOrganization(input: { organizationId: string }) {
    return (
      this.overrides.listIdsByOrganization?.(input) ?? this.unimplemented("listIdsByOrganization")
    );
  }

  listPaths(input: { projectIds: string[] }) {
    return this.overrides.listPaths?.(input) ?? this.unimplemented("listPaths");
  }

  constructor(private readonly overrides: Partial<ProjectApi>) {}

  isPresenceEnabled: ProjectApi["isPresenceEnabled"] = (input) =>
    this.overrides.isPresenceEnabled?.(input) ?? Promise.resolve(false);

  tryGetSummaryById: ProjectApi["tryGetSummaryById"] = (projectId) =>
    this.overrides.tryGetSummaryById?.(projectId) ?? Promise.resolve(null);

  tryGetById: ProjectApi["tryGetById"] = (id) => {
    return this.overrides.tryGetById?.(id) ?? Promise.resolve(null);
  };

  getOrganizationId: ProjectApi["getOrganizationId"] = (projectId) => {
    return this.overrides.getOrganizationId?.(projectId) ?? this.unimplemented("getOrganizationId");
  };

  getWithTeam: ProjectApi["getWithTeam"] = (id) => {
    return this.overrides.getWithTeam?.(id) ?? this.unimplemented("getWithTeam");
  };

  tryGetWithTeam: ProjectApi["tryGetWithTeam"] = (id) => {
    return this.overrides.tryGetWithTeam?.(id) ?? Promise.resolve(null);
  };

  listByOrganization: ProjectApi["listByOrganization"] = (input) => {
    return (
      this.overrides.listByOrganization?.(input) ??
      Promise.resolve({ data: [], pagination: { page: input.page, limit: input.limit, total: 0 } })
    );
  };

  listByTeam: ProjectApi["listByTeam"] = (input) => {
    return this.overrides.listByTeam?.(input) ?? Promise.resolve([]);
  };

  create: ProjectApi["create"] = (input, by) => {
    return this.overrides.create?.(input, by) ?? this.unimplemented("create");
  };

  updateSettings: ProjectApi["updateSettings"] = (input) => {
    return this.overrides.updateSettings?.(input) ?? this.unimplemented("updateSettings");
  };

  archive: ProjectApi["archive"] = (input) => {
    return this.overrides.archive?.(input) ?? Promise.resolve({ alreadyArchived: false });
  };

  regenerateLegacyProjectKey: ProjectApi["regenerateLegacyProjectKey"] = (input) => {
    return (
      this.overrides.regenerateLegacyProjectKey?.(input) ??
      this.unimplemented("regenerateLegacyProjectKey")
    );
  };

  requestTopicClustering: ProjectApi["requestTopicClustering"] = (input, by) => {
    return (
      this.overrides.requestTopicClustering?.(input, by) ??
      this.unimplemented("requestTopicClustering")
    );
  };

  touchCodingAgentPullRequestSeen: ProjectApi["touchCodingAgentPullRequestSeen"] = (input) => {
    return this.overrides.touchCodingAgentPullRequestSeen?.(input) ?? Promise.resolve();
  };

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectApi does not implement ${operation}`));
  }
}

async function expectRefusal(
  call: Promise<unknown>,
  expected: { code: string; httpStatus: number },
): Promise<void> {
  await expect(call).rejects.toMatchObject({
    cause: { code: expected.code, httpStatus: expected.httpStatus },
  });
}

function harness({
  projects = {},
  probeProjectPermission = async () => true,
  fieldProtections = {},
}: {
  projects?: Partial<ProjectApi>;
  probeProjectPermission?: () => Promise<boolean>;
  fieldProtections?: Record<string, unknown>;
} = {}) {
  const provisionLangyVirtualKey = vi.fn(async () => {});
  const recordApiKeyRegenerated = vi.fn(async () => {});
  const reportTopicClusteringFailure = vi.fn();
  const encryptProjectSecret = vi.fn((value: string) => `encrypted(${value})`);
  const probe = vi.fn(probeProjectPermission);

  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const router = ProjectTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      policy: () => (procedure) => procedure,
      // Every answer this suite asserts on is checked against the output
      // schema the procedure declares, which is what makes those declarations
      // load-bearing rather than documentation.
      validateOutput: true,
      createPolicy: (procedure) => procedure,
      updatePolicy: (procedure) => procedure,
    },
    {
      encryptProjectSecret,
      probeProjectPermission: probe,
      getFieldProtections: async () => fieldProtections,
      provisionLangyVirtualKey,
      recordApiKeyRegenerated,
      reportTopicClusteringFailure,
    },
  );

  return {
    router,
    provisionLangyVirtualKey,
    recordApiKeyRegenerated,
    reportTopicClusteringFailure,
    encryptProjectSecret,
    probeProjectPermission: probe,
    caller: router.createCaller({
      app: {
        projects: new TestProjectApi(projects),
      },
      actor: () => ({ id: "test-user-id" }),
      session: { user: { id: "test-user-id" } },
    }),
  };
}

describe("ProjectOperationsService characterization", () => {
  it("revokes outstanding trace shares when sharing is turned off", async () => {
    const revokeAllTraceShares = vi.fn(async () => {});
    const updated = characterizationProject(false);
    const update = vi.fn(async () => updated);
    const operations = characterizationOperations({
      projects: {
        tryGetWithTeam: async () => characterizationProject(true),
        update,
      },
      revokeAllTraceShares,
    });

    await operations.updateSettings({ projectId: "project_123", traceSharingEnabled: false });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "project_123", organizationId: "org-1" }),
    );
    expect(revokeAllTraceShares).toHaveBeenCalledWith("project_123");
  });

  it("leaves shares alone when trace sharing was already off", async () => {
    const revokeAllTraceShares = vi.fn(async () => {});
    const operations = characterizationOperations({
      projects: {
        tryGetWithTeam: async () => characterizationProject(false),
        update: async () => characterizationProject(false),
      },
      revokeAllTraceShares,
    });

    await operations.updateSettings({ projectId: "project_123", traceSharingEnabled: false });

    expect(revokeAllTraceShares).not.toHaveBeenCalled();
  });
});

describe("ProjectTrpcApi", () => {
  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware at the point `.input()` is called, so
     * anything installed before it runs with `input === undefined`.
     */
    it("hands the policy the parsed input, not undefined", async () => {
      const seen: unknown[] = [];
      const trpc = initTRPC.context<TestContext>().create();
      const recordingPolicy =
        () =>
        <TProcedure>(procedure: TProcedure): TProcedure =>
          (procedure as { use(fn: unknown): unknown }).use(
            ({ input, next }: { input: unknown; next: () => unknown }) => {
              seen.push(input);
              return next();
            },
          ) as TProcedure;

      const router = ProjectTrpcApi.create(
        trpc,
        {
          protected: trpc.procedure,
          policy: recordingPolicy,
          validateOutput: true,
          createPolicy: recordingPolicy(),
          updatePolicy: recordingPolicy(),
        },
        {
          encryptProjectSecret: (value) => value,
          probeProjectPermission: async () => true,
          getFieldProtections: async () => ({}),
          provisionLangyVirtualKey: async () => {},
          recordApiKeyRegenerated: async () => {},
          reportTopicClusteringFailure: () => {},
        },
      );

      await router
        .createCaller({
          app: {
            projects: new TestProjectApi({ tryGetById: async () => null }),
          },
          actor: () => ({ id: "test-user-id" }),
          session: { user: { id: "test-user-id" } },
        })
        .getHasFirstMessage({ projectId: "project_123" });

      expect(seen).toEqual([{ projectId: "project_123" }]);
    });
  });

  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "archiveById",
        "create",
        "getFieldRedactionStatus",
        "getHasFirstMessage",
        "getProjectAPIKey",
        "regenerateApiKey",
        "triggerTopicClustering",
        "update",
      ]);
    });
  });

  describe("when a project has received traces", () => {
    /** @scenario Shows Integration configured alert when firstMessage exists */
    it("returns firstMessage as true", async () => {
      const tryGetById = vi.fn(async () => ({ firstMessage: true }) as never);
      const { caller } = harness({ projects: { tryGetById } });

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).resolves.toEqual({
        firstMessage: true,
      });
      expect(tryGetById).toHaveBeenCalledWith("project_123");
    });
  });

  describe("when a project has not received traces", () => {
    /** @scenario Shows Waiting for messages when no firstMessage */
    it("returns firstMessage as false", async () => {
      const { caller } = harness({
        projects: { tryGetById: async () => ({ firstMessage: false }) as never },
      });

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).resolves.toEqual({
        firstMessage: false,
      });
    });

    it("answers false rather than 404 for a project that does not exist", async () => {
      const { caller } = harness({ projects: { tryGetById: async () => null } });

      await expect(caller.getHasFirstMessage({ projectId: "nonexistent" })).resolves.toEqual({
        firstMessage: false,
      });
    });
  });

  describe("when the base key is read", () => {
    it("refuses a project that does not exist as not found", async () => {
      const { caller } = harness({ projects: { tryGetById: async () => null } });

      await expectRefusal(caller.getProjectAPIKey({ projectId: "nope" }), {
        code: "project_not_found",
        httpStatus: 404,
      });
    });
  });

  describe("when the project write key is rotated", () => {
    /** @scenario "Rotation is recorded for audit" */
    it("returns the new key and records the rotation", async () => {
      const { caller, recordApiKeyRegenerated } = harness({
        projects: { regenerateLegacyProjectKey: async () => "sk-lw-new" },
      });

      await expect(caller.regenerateApiKey({ projectId: "project_123" })).resolves.toEqual({
        apiKey: "sk-lw-new",
      });
      expect(recordApiKeyRegenerated).toHaveBeenCalledWith({
        userId: "test-user-id",
        projectId: "project_123",
      });
    });

    it("lets the credential's own not-found refusal through", async () => {
      const { caller } = harness({
        projects: {
          regenerateLegacyProjectKey: async () => {
            throw new ApiKeyNotFoundError("nonexistent_project");
          },
        },
      });

      await expectRefusal(caller.regenerateApiKey({ projectId: "nonexistent_project" }), {
        code: "api_key_not_found",
        httpStatus: 404,
      });
    });

    it("re-throws any other service failure", async () => {
      const { caller } = harness({
        projects: {
          regenerateLegacyProjectKey: async () => {
            throw new Error("Connection error");
          },
        },
      });

      await expect(caller.regenerateApiKey({ projectId: "project_123" })).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Connection error",
      });
    });

    it("does not record a rotation that never happened", async () => {
      const { caller, recordApiKeyRegenerated } = harness({
        projects: {
          regenerateLegacyProjectKey: async () => {
            throw new Error("Database connection failed");
          },
        },
      });

      await expect(caller.regenerateApiKey({ projectId: "project_123" })).rejects.toBeDefined();
      expect(recordApiKeyRegenerated).not.toHaveBeenCalled();
    });
  });

  describe("when the settings form is saved", () => {
    it("encrypts every stored-object credential before it is persisted", async () => {
      const update = vi.fn(async () => ({ slug: "my-project" }) as never);
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () =>
            ({ team: { organizationId: "org-1" }, traceSharingEnabled: false }) as never,
          updateSettings: update,
        },
      });

      await expect(
        caller.update({
          projectId: "project_123",
          s3Endpoint: "https://s3.example",
          s3AccessKeyId: "AKIA",
          s3SecretAccessKey: "shh",
          s3Bucket: "bucket",
        }),
      ).resolves.toEqual({ success: true, projectSlug: "my-project" });

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_123",
          s3Endpoint: "encrypted(https://s3.example)",
          s3AccessKeyId: "encrypted(AKIA)",
          s3SecretAccessKey: "encrypted(shh)",
          s3Bucket: "bucket",
        }),
      );
    });

    it("refuses a half-filled stored-object credential set", async () => {
      const { caller } = harness();

      await expect(
        caller.update({ projectId: "project_123", s3Endpoint: "https://s3.example" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("refuses a project that no longer exists as not found", async () => {
      const { caller } = harness({
        projects: {
          updateSettings: async () => {
            throw new ProjectNotFoundError("project_123");
          },
        },
      });

      await expectRefusal(caller.update({ projectId: "project_123", name: "Renamed" }), {
        code: "project_not_found",
        httpStatus: 404,
      });
    });

    it("refuses a move that crosses the personal-workspace boundary", async () => {
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () =>
            ({ team: { organizationId: "org-1" }, traceSharingEnabled: false }) as never,
          updateSettings: async () => {
            throw new PersonalWorkspaceBoundaryError("personal workspaces hold one project");
          },
        },
      });

      await expectRefusal(caller.update({ projectId: "project_123", teamId: "team-2" }), {
        code: "personal_workspace_boundary",
        httpStatus: 403,
      });
    });
  });

  describe("when another project is archived", () => {
    it("refuses to archive the project the caller is currently in", async () => {
      const { caller, probeProjectPermission } = harness();

      await expectRefusal(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "project_123" }),
        { code: "project_cannot_archive_current", httpStatus: 400 },
      );
      expect(probeProjectPermission).not.toHaveBeenCalled();
    });

    it("probes the target project on its own before reading it", async () => {
      const tryGetWithTeam = vi.fn();
      const { caller, probeProjectPermission } = harness({
        probeProjectPermission: async () => false,
        projects: { tryGetWithTeam },
      });

      await expectRefusal(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "victim" }),
        { code: "project_permission_denied", httpStatus: 403 },
      );
      expect(probeProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "victim",
        "project:delete",
      );
      expect(tryGetWithTeam).not.toHaveBeenCalled();
    });

    it("reports an already-archived project as done rather than missing", async () => {
      const { caller } = harness({
        projects: { archive: async () => ({ alreadyArchived: true }) },
      });

      await expect(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "gone" }),
      ).resolves.toEqual({ success: true, alreadyArchived: true });
    });

    it("refuses to archive a personal project", async () => {
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () => ({ team: { organizationId: "org-1" } }) as never,
          archive: async () => {
            throw new PersonalProjectProtectedError("personal projects cannot be archived");
          },
        },
      });

      await expectRefusal(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "personal" }),
        { code: "personal_project_protected", httpStatus: 403 },
      );
    });

    it("treats a project that vanished mid-archive as already archived", async () => {
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () => ({ team: { organizationId: "org-1" } }) as never,
          archive: async () => {
            throw new ProjectNotFoundError("gone");
          },
        },
      });

      await expectRefusal(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "gone" }),
        { code: "project_not_found", httpStatus: 404 },
      );
    });
  });

  describe("when a project is created", () => {
    it("mints Langy's virtual key alongside it and returns the slug", async () => {
      const create = vi.fn(async () => ({ id: "project_new", slug: "new-project" }) as never);
      const { caller, provisionLangyVirtualKey } = harness({ projects: { create } });

      await expect(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
      ).resolves.toEqual({ success: true, projectSlug: "new-project" });

      // The creation is attributed to the caller by the application, not by
      // the transport: no handler stamps a user id of its own.
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }), {
        id: "test-user-id",
      });
      expect(provisionLangyVirtualKey).toHaveBeenCalledWith(expect.anything(), {
        projectId: "project_new",
        organizationId: "org-1",
        actorUserId: "test-user-id",
      });
    });

    it("refuses a team from another organization", async () => {
      const { caller } = harness({
        projects: {
          create: async () => {
            throw new TeamNotInOrganizationError("team-1 is not in org-1");
          },
        },
      });

      await expectRefusal(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
        { code: "team_not_in_organization", httpStatus: 400 },
      );
    });

    it("refuses a slug that is already taken", async () => {
      const { caller } = harness({
        projects: {
          create: async () => {
            throw new ProjectSlugConflictError("new-project");
          },
        },
      });

      await expectRefusal(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
        { code: "project_slug_taken", httpStatus: 409 },
      );
    });
  });

  describe("when the viewer's captured content is restricted", () => {
    it("reports each field as redacted and who may still read it", async () => {
      const { caller } = harness({
        fieldProtections: {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: true,
          capturedInputVisibleTo: "Admins, Security",
        },
      });

      await expect(caller.getFieldRedactionStatus({ projectId: "project_123" })).resolves.toEqual({
        isRedacted: { input: true, output: false },
        visibleTo: { input: "Admins, Security", output: null },
      });
    });
  });

  describe("when a manual topic-clustering run is asked for", () => {
    it("says a run is already going rather than reporting a start that did not happen", async () => {
      const requestClustering = vi.fn(async () => ({
        started: false,
        reason: "already_running" as const,
      }));
      const { caller } = harness({
        projects: { requestTopicClustering: requestClustering },
      });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: false,
        reason: "already_running",
      });
      expect(requestClustering).toHaveBeenCalledWith(
        { projectId: "project_123" },
        { id: "test-user-id" },
      );
    });

    it("sends the manual request attributed to the caller", async () => {
      const requestClustering = vi.fn(async () => ({ started: true as const }));
      const { caller } = harness({
        projects: { requestTopicClustering: requestClustering },
      });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: true,
      });
      expect(requestClustering).toHaveBeenCalledWith(
        { projectId: "project_123" },
        { id: "test-user-id" },
      );
    });

    /**
     * The one cause behind this that IS nameable: a deployment that composed
     * no scheduler refuses by name, and the caller can act on it — there is
     * nothing to retry, and somebody has to turn the service on. Re-raised
     * untouched, it reaches the client as its own code; wrapped, the client
     * would get a trace id for a condition we could have named.
     *
     * @scenario "A deployment without a clustering scheduler refuses by name"
     */
    it("re-raises a named refusal rather than degrading it", async () => {
      const { caller, reportTopicClusteringFailure } = harness({
        projects: {
          requestTopicClustering: async () => {
            throw new NoClusteringSchedulerError();
          },
        },
      });

      await expectRefusal(caller.triggerTopicClustering({ projectId: "project_123" }), {
        code: "service_unavailable",
        httpStatus: 503,
      });
      expect(reportTopicClusteringFailure).toHaveBeenCalledWith(expect.any(Error), {
        projectId: "project_123",
      });
    });

    /**
     * The cause is an event-store internal, which is neither nameable nor
     * actionable, so it stays an ordinary error and degrades to an unknown
     * failure with a trace id rather than being dressed up as handled.
     *
     * @scenario "A clustering run that fails inside the platform degrades to an unknown failure"
     */
    it("reports the failure and raises an unhandled error", async () => {
      const { caller, reportTopicClusteringFailure } = harness({
        projects: {
          requestTopicClustering: async () => {
            throw new Error("projection host db-7 unreachable");
          },
        },
      });

      await expect(
        caller.triggerTopicClustering({ projectId: "project_123" }),
      ).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to trigger topic clustering",
      });
      expect(reportTopicClusteringFailure).toHaveBeenCalledWith(expect.any(Error), {
        projectId: "project_123",
      });
    });
  });
});
