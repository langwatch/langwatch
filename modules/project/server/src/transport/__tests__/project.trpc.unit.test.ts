/**
 * @vitest-environment node
 * The `project.*` procedures over the real runtime, one `ProjectApi` fake and
 * the six deployment answers the door names. Every answer is checked against
 * the declared output schema, which is what makes it load-bearing.
 * Spec: modules/project/specs/project-service.feature.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectApi,
} from "@langwatch/project-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { projectTrpcTransport, type ProjectBrowserApi } from "../project.trpc.ts";
import { projectTrpcTestPorts, type ProjectTrpcTestContext } from "./project.trpc.harness.ts";
import { TestProjectApi } from "./support/test-project-api.ts";

const ACTOR_ID = "test-user-id";

/**
 * The refusal a deployment raises when it composed no clustering scheduler —
 * the API process is the deployment that does.
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

async function expectRefusal(
  call: Promise<unknown>,
  expected: { code: string; httpStatus: number },
): Promise<void> {
  await expect(call).rejects.toMatchObject({
    cause: { code: expected.code, httpStatus: expected.httpStatus },
  });
}

function mount({
  projects = {},
  probePermission = async () => true,
  fieldProtections = {},
}: {
  projects?: Partial<ProjectApi>;
  probePermission?: () => Promise<boolean>;
  fieldProtections?: Record<string, unknown>;
} = {}) {
  const provisionLangyVirtualKey = vi.fn(async () => {});
  const recordApiKeyRegenerated = vi.fn(async () => {});
  const reportTopicClusteringFailure = vi.fn();
  const encryptProjectSecret = vi.fn((value: string) => `encrypted(${value})`);
  const probe = vi.fn(probePermission);
  const application = new TestProjectApi(projects);

  const browser: ProjectBrowserApi = {
    projects: () => application,
    encryptProjectSecret,
    probePermission: probe,
    getFieldProtections: async () => fieldProtections,
    provisionLangyVirtualKey,
    recordApiKeyRegenerated,
    reportTopicClusteringFailure,
  };

  const trpc = initTRPC.context<ProjectTrpcTestContext>().create();
  const router = createTrpcRuntime<ProjectTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: projectTrpcTestPorts(),
  }).mount(projectTrpcTransport, () => browser);

  return {
    router,
    provisionLangyVirtualKey,
    recordApiKeyRegenerated,
    reportTopicClusteringFailure,
    encryptProjectSecret,
    probePermission: probe,
    caller: router.createCaller({ actor: { id: ACTOR_ID } }),
  };
}

describe("the project tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

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
      const { caller } = mount({ projects: { tryGetById } });

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).resolves.toEqual({
        firstMessage: true,
      });
      expect(tryGetById).toHaveBeenCalledWith("project_123");
    });
  });

  describe("when a project has not received traces", () => {
    /** @scenario Shows Waiting for messages when no firstMessage */
    it("returns firstMessage as false", async () => {
      const { caller } = mount({
        projects: { tryGetById: async () => ({ firstMessage: false }) as never },
      });

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).resolves.toEqual({
        firstMessage: false,
      });
    });

    it("answers false rather than 404 for a project that does not exist", async () => {
      const { caller } = mount({ projects: { tryGetById: async () => null } });

      await expect(caller.getHasFirstMessage({ projectId: "nonexistent" })).resolves.toEqual({
        firstMessage: false,
      });
    });
  });

  describe("when the base key is read", () => {
    it("refuses a project that does not exist as not found", async () => {
      const { caller } = mount({ projects: { tryGetById: async () => null } });

      await expectRefusal(caller.getProjectAPIKey({ projectId: "nope" }), {
        code: "project_not_found",
        httpStatus: 404,
      });
    });
  });

  describe("when the project write key is rotated", () => {
    /** @scenario "Rotation is recorded for audit" */
    it("returns the new key and records the rotation", async () => {
      const { caller, recordApiKeyRegenerated } = mount({
        projects: { regenerateLegacyProjectKey: async () => "sk-lw-new" },
      });

      await expect(caller.regenerateApiKey({ projectId: "project_123" })).resolves.toEqual({
        apiKey: "sk-lw-new",
      });
      expect(recordApiKeyRegenerated).toHaveBeenCalledWith({
        userId: ACTOR_ID,
        projectId: "project_123",
      });
    });

    it("lets the credential's own not-found refusal through", async () => {
      const { caller } = mount({
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
      const { caller } = mount({
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
      const { caller, recordApiKeyRegenerated } = mount({
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
      const { caller } = mount({ projects: { updateSettings: update } });

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
      const { caller } = mount();

      await expect(
        caller.update({ projectId: "project_123", s3Endpoint: "https://s3.example" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("refuses a project that no longer exists as not found", async () => {
      const { caller } = mount({
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
      const { caller } = mount({
        projects: {
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

  describe("when the form flips trace sharing", () => {
    /**
     * `traceSharingEnabled` changes who OUTSIDE the project can read its
     * traces, so it costs `project:manage` on top of `project:update`.
     */
    it("asks for project:manage on that project alone", async () => {
      const update = vi.fn(async () => ({ slug: "my-project" }) as never);
      const { caller, probePermission } = mount({ projects: { updateSettings: update } });

      await caller.update({ projectId: "project_123", traceSharingEnabled: true });

      expect(probePermission).toHaveBeenCalledWith({
        permission: "project:manage",
        scope: { tier: "project", id: "project_123" },
      });
    });

    it("refuses a caller who may update the project but not manage it", async () => {
      const update = vi.fn(async () => ({ slug: "my-project" }) as never);
      const { caller } = mount({
        projects: { updateSettings: update },
        probePermission: async () => false,
      });

      await expectRefusal(
        caller.update({ projectId: "project_123", traceSharingEnabled: true }),
        { code: "permission_denied", httpStatus: 403 },
      );
      expect(update).not.toHaveBeenCalled();
    });

    it("asks nothing extra of a form that leaves trace sharing alone", async () => {
      const { caller, probePermission } = mount({
        projects: { updateSettings: async () => ({ slug: "my-project" }) as never },
      });

      await caller.update({ projectId: "project_123", name: "Renamed" });

      expect(probePermission).not.toHaveBeenCalled();
    });
  });

  describe("when another project is archived", () => {
    it("refuses to archive the project the caller is currently in", async () => {
      const { caller, probePermission } = mount();

      await expectRefusal(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "project_123" }),
        { code: "project_cannot_archive_current", httpStatus: 400 },
      );
      expect(probePermission).not.toHaveBeenCalled();
    });

    it("probes the target project on its own before reading it", async () => {
      const archive = vi.fn(async () => ({ alreadyArchived: false }));
      const { caller, probePermission } = mount({
        probePermission: async () => false,
        projects: { archive },
      });

      await expectRefusal(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "victim" }),
        { code: "project_permission_denied", httpStatus: 403 },
      );
      expect(probePermission).toHaveBeenCalledWith({
        permission: "project:delete",
        scope: { tier: "project", id: "victim" },
      });
      expect(archive).not.toHaveBeenCalled();
    });

    it("reports an already-archived project as done rather than missing", async () => {
      const { caller } = mount({
        projects: { archive: async () => ({ alreadyArchived: true }) },
      });

      await expect(
        caller.archiveById({ projectId: "project_123", projectToArchiveId: "gone" }),
      ).resolves.toEqual({ success: true, alreadyArchived: true });
    });

    it("refuses to archive a personal project", async () => {
      const { caller } = mount({
        projects: {
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
      const { caller } = mount({
        projects: {
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
      const { caller, provisionLangyVirtualKey } = mount({ projects: { create } });

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
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
        expect.objectContaining({ id: ACTOR_ID }),
      );
      expect(provisionLangyVirtualKey).toHaveBeenCalledWith({
        projectId: "project_new",
        organizationId: "org-1",
        actorUserId: ACTOR_ID,
      });
    });

    /**
     * Creating INTO a team asks that team for `project:create`; creating a
     * team alongside asks the organization for `organization:manage`. Which of
     * the two applies is only known once the input is parsed, which is why the
     * declaration hands the question to the handler.
     */
    it("asks the named team for project:create", async () => {
      const { caller, probePermission } = mount({
        projects: { create: async () => ({ id: "project_new", slug: "new" }) as never },
      });

      await caller.create({
        organizationId: "org-1",
        teamId: "team-1",
        name: "New",
        language: "python",
        framework: "openai",
      });

      expect(probePermission).toHaveBeenCalledWith({
        permission: "project:create",
        scope: { tier: "team", id: "team-1" },
      });
    });

    it("asks the organization for organization:manage when a team is created alongside", async () => {
      const { caller, probePermission } = mount({
        projects: { create: async () => ({ id: "project_new", slug: "new" }) as never },
      });

      await caller.create({
        organizationId: "org-1",
        newTeamName: "New Team",
        name: "New",
        language: "python",
        framework: "openai",
      });

      expect(probePermission).toHaveBeenCalledWith({
        permission: "organization:manage",
        scope: { tier: "organization", id: "org-1" },
      });
    });

    it("refuses a caller who holds neither, and creates nothing", async () => {
      const create = vi.fn(async () => ({ id: "project_new", slug: "new" }) as never);
      const { caller } = mount({ projects: { create }, probePermission: async () => false });

      await expectRefusal(
        caller.create({
          organizationId: "org-1",
          teamId: "team-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
        { code: "permission_denied", httpStatus: 403 },
      );
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a request naming neither an existing team nor a new one", async () => {
      const { caller, probePermission } = mount();

      await expectRefusal(
        caller.create({
          organizationId: "org-1",
          name: "New",
          language: "python",
          framework: "openai",
        }),
        { code: "validation_error", httpStatus: 400 },
      );
      expect(probePermission).not.toHaveBeenCalled();
    });

    it("refuses a team from another organization", async () => {
      const { caller } = mount({
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
      const { caller } = mount({
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
      const { caller } = mount({
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
      const { caller } = mount({ projects: { requestTopicClustering: requestClustering } });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: false,
        reason: "already_running",
      });
      expect(requestClustering).toHaveBeenCalledWith(
        { projectId: "project_123" },
        expect.objectContaining({ id: ACTOR_ID }),
      );
    });

    it("sends the manual request attributed to the caller", async () => {
      const requestClustering = vi.fn(async () => ({ started: true as const }));
      const { caller } = mount({ projects: { requestTopicClustering: requestClustering } });

      await expect(caller.triggerTopicClustering({ projectId: "project_123" })).resolves.toEqual({
        started: true,
      });
      expect(requestClustering).toHaveBeenCalledWith(
        { projectId: "project_123" },
        expect.objectContaining({ id: ACTOR_ID }),
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
      const { caller, reportTopicClusteringFailure } = mount({
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
      const { caller, reportTopicClusteringFailure } = mount({
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
