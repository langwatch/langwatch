/**
 * @vitest-environment node
 *
 * The `project.*` tRPC surface: the eight procedure names the clients call,
 * the contract errors each maps to a status, the second permission probe
 * `archiveById` runs on the project it actually archives, the trace-share
 * revocation that follows turning sharing off, and the two best-effort side
 * effects (Langy's virtual key, the rotation audit) that must never fail the
 * call they hang off.
 *
 * The procedure handed in narrows its own context the way an authenticated
 * process procedure does, so this also pins that a process can hand over a
 * procedure it has already composed.
 */
import { ApiKeyNotFoundError, type ApiKeyService } from "@langwatch/api-key-contract";
import {
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectService,
} from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectTrpcApi } from "../src/api/app-trpc/project.api";

type TopicClusteringCommands = {
  requestClustering(input: {
    tenantId: string;
    occurredAt: number;
    trigger: "manual";
    requestedByUserId: string;
  }): Promise<void>;
};

type TestContext = {
  app: {
    projects: ProjectService;
    apiKeys: ApiKeyService;
    share: ShareService;
    topics: TopicService;
    topicClustering: TopicClusteringCommands;
  };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

function harness({
  projects = {},
  apiKeys = {},
  share = {},
  topics = {},
  topicClustering = {},
  probeProjectPermission = async () => true,
  fieldProtections = {},
}: {
  projects?: Partial<ProjectService>;
  apiKeys?: Partial<ApiKeyService>;
  share?: Partial<ShareService>;
  topics?: Partial<TopicService>;
  topicClustering?: Partial<TopicClusteringCommands>;
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
        projects: projects as ProjectService,
        apiKeys: apiKeys as ApiKeyService,
        share: share as ShareService,
        topics: topics as TopicService,
        topicClustering: topicClustering as TopicClusteringCommands,
      },
      actor: () => ({ id: "test-user-id" }),
      session: { user: { id: "test-user-id" } },
    }),
  };
}

describe("ProjectTrpcApi", () => {
  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware at the point `.input()`
     * is called, so anything installed before it runs with `input ===
     * undefined`. The process's real policy resolves the authorized scope id
     * FROM the input, which is why this feature applies the decorator after
     * its own parser. Installed the other way round, the authorization check,
     * the scope-lineage guard and the audit row would all see nothing and
     * every guard would still report green.
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
            projects: { tryGetById: async () => null } as unknown as ProjectService,
            apiKeys: {} as ApiKeyService,
            share: {} as ShareService,
            topics: {} as TopicService,
            topicClustering: {} as TopicClusteringCommands,
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
    it("refuses with NOT_FOUND for a project that does not exist", async () => {
      const { caller } = harness({ projects: { tryGetById: async () => null } });

      await expect(caller.getProjectAPIKey({ projectId: "nope" })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    });
  });

  describe("when the project write key is rotated", () => {
    it("returns the new key and records the rotation", async () => {
      const { caller, recordApiKeyRegenerated } = harness({
        apiKeys: { regenerateLegacyProjectKey: async () => "sk-lw-new" },
      });

      await expect(caller.regenerateApiKey({ projectId: "project_123" })).resolves.toEqual({
        apiKey: "sk-lw-new",
      });
      expect(recordApiKeyRegenerated).toHaveBeenCalledWith({
        userId: "test-user-id",
        projectId: "project_123",
      });
    });

    it("reports a missing credential as NOT_FOUND without naming it", async () => {
      const { caller } = harness({
        apiKeys: {
          regenerateLegacyProjectKey: async () => {
            throw new ApiKeyNotFoundError("nonexistent_project");
          },
        },
      });

      await expect(
        caller.regenerateApiKey({ projectId: "nonexistent_project" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found" });
    });

    it("re-throws any other service failure", async () => {
      const { caller } = harness({
        apiKeys: {
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
        apiKeys: {
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
          update,
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
          id: "project_123",
          organizationId: "org-1",
          data: expect.objectContaining({
            s3Endpoint: "encrypted(https://s3.example)",
            s3AccessKeyId: "encrypted(AKIA)",
            s3SecretAccessKey: "encrypted(shh)",
            s3Bucket: "bucket",
          }),
        }),
      );
    });

    it("revokes the outstanding trace shares when sharing is turned off", async () => {
      const revokeAllTraceShares = vi.fn(async () => {});
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () =>
            ({ team: { organizationId: "org-1" }, traceSharingEnabled: true }) as never,
          update: async () => ({ slug: "my-project" }) as never,
        },
        share: { revokeAllTraceShares },
      });

      await caller.update({ projectId: "project_123", traceSharingEnabled: false });

      expect(revokeAllTraceShares).toHaveBeenCalledWith("project_123");
    });

    it("leaves the shares alone when sharing was already off", async () => {
      const revokeAllTraceShares = vi.fn(async () => {});
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () =>
            ({ team: { organizationId: "org-1" }, traceSharingEnabled: false }) as never,
          update: async () => ({ slug: "my-project" }) as never,
        },
        share: { revokeAllTraceShares },
      });

      await caller.update({ projectId: "project_123", traceSharingEnabled: false });

      expect(revokeAllTraceShares).not.toHaveBeenCalled();
    });

    it("refuses a half-filled stored-object credential set", async () => {
      const { caller } = harness();

      await expect(
        caller.update({ projectId: "project_123", s3Endpoint: "https://s3.example" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("reports a move to a team outside the organization as BAD_REQUEST", async () => {
      const { caller } = harness({
        projects: {
          tryGetWithTeam: async () =>
            ({ team: { organizationId: "org-1" }, traceSharingEnabled: false }) as never,
          update: async () => {
            throw new PersonalWorkspaceBoundaryError("personal workspaces hold one project");
          },
        },
      });

      await expect(
        caller.update({ projectId: "project_123", teamId: "team-2" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("when another project is archived", () => {
    it("refuses to archive the project the caller is currently in", async () => {
      const { caller, probeProjectPermission } = harness();

      await expect(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "project_123" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(probeProjectPermission).not.toHaveBeenCalled();
    });

    it("probes the target project on its own before reading it", async () => {
      const tryGetWithTeam = vi.fn();
      const { caller, probeProjectPermission } = harness({
        probeProjectPermission: async () => false,
        projects: { tryGetWithTeam },
      });

      await expect(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "victim" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(probeProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "victim",
        "project:delete",
      );
      expect(tryGetWithTeam).not.toHaveBeenCalled();
    });

    it("reports an already-archived project as done rather than missing", async () => {
      const { caller } = harness({ projects: { tryGetWithTeam: async () => null } });

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

      await expect(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "personal" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

      await expect(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "gone" }),
      ).resolves.toEqual({ success: true, alreadyArchived: true });
    });
  });

  describe("when a project is created", () => {
    it("mints Langy's virtual key alongside it and returns the slug", async () => {
      const { caller, provisionLangyVirtualKey } = harness({
        projects: {
          create: async () => ({ id: "project_new", slug: "new-project" }) as never,
        },
      });

      await expect(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
      ).resolves.toEqual({ success: true, projectSlug: "new-project" });

      expect(provisionLangyVirtualKey).toHaveBeenCalledWith(expect.anything(), {
        projectId: "project_new",
        organizationId: "org-1",
        actorUserId: "test-user-id",
      });
    });

    it("reports a team from another organization as BAD_REQUEST", async () => {
      const { caller } = harness({
        projects: {
          create: async () => {
            throw new TeamNotInOrganizationError("team-1 is not in org-1");
          },
        },
      });

      await expect(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("reports a slug that is already taken as CONFLICT", async () => {
      const { caller } = harness({
        projects: {
          create: async () => {
            throw new ProjectSlugConflictError("new-project");
          },
        },
      });

      await expect(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
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
      const requestClustering = vi.fn(async () => {});
      const { caller } = harness({
        topics: { getClusteringStatus: async () => ({ isRunInFlight: true }) as never },
        topicClustering: { requestClustering },
      });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: false,
        reason: "already_running",
      });
      expect(requestClustering).not.toHaveBeenCalled();
    });

    it("sends the manual request attributed to the caller", async () => {
      const requestClustering = vi.fn(async () => {});
      const { caller } = harness({
        topics: { getClusteringStatus: async () => ({ isRunInFlight: false }) as never },
        topicClustering: { requestClustering },
      });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: true,
      });
      expect(requestClustering).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_123",
          trigger: "manual",
          requestedByUserId: "test-user-id",
        }),
      );
    });

    it("reports the failure and hands the customer a fixed sentence", async () => {
      const { caller, reportTopicClusteringFailure } = harness({
        topics: {
          getClusteringStatus: async () => {
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
