/**
 * @vitest-environment node
 * The `project.*` procedures over the real runtime, one `ProjectApi` fake
 * and the six deployment answers the door names — every answer checked
 * against the declared output schema. Spec: modules/project/specs/project-service.feature.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import {
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type ProjectApi,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectRequestService } from "../../services/project-request.service.ts";
import { projectTrpcTransport, type ProjectBrowserApi } from "../project.trpc.ts";
import type { ProjectTrpcTestContext } from "./project.trpc.harness.ts";

const ACTOR_ID = "test-user-id";

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
  permits = () => true,
}: {
  projects?: Partial<ProjectApi>;
  probePermission?: () => Promise<boolean>;
  fieldProtections?: Record<string, unknown>;
  /**
   * The authorization answer for THIS request, at the scope the input named.
   * The door resolves it per call, so two calls with two answers are two
   * projects as far as every procedure below can tell.
   */
  permits?: (permission: string) => boolean;
} = {}) {
  const probe = vi.fn(probePermission);
  const application = createApiFixture<ProjectApi>(projects, "ProjectApi");
  const requests = ProjectRequestService.create({
    projects: application,
    probePermission: probe,
  });

  const revokeProjectApiKey = vi.fn(
    async (_input: { projectId: string; by: { id: string } }) => {},
  );
  const getLegacyKeyStatus = vi.fn(async (_input: { projectId: string }) => ({ present: true }));
  const browser: ProjectBrowserApi = {
    projects: () => application,
    revokeProjectApiKey,
    getLegacyKeyStatus,
    probePermission: probe,
    getFieldProtections: async () => fieldProtections,
    archiveOtherProject: (input) => requests.archiveOtherProject(input),
  };

  const trpc = initTRPC.context<ProjectTrpcTestContext>().create();
  const router = createTrpcRuntime<ProjectTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<ProjectTrpcTestContext>({ permits }),
  }).mount(projectTrpcTransport, () => browser);

  return {
    router,
    revokeProjectApiKey,
    getLegacyKeyStatus,
    probePermission: probe,
    caller: router.createCaller({ actor: { id: ACTOR_ID } }),
  };
}

describe("the project tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "archiveById",
        "create",
        "getFieldRedactionStatus",
        "getHasFirstMessage",
        "getLegacyKeyStatus",
        "revokeProjectApiKey",
        "update",
      ]);
    });
  });

  describe("when a project has received traces", () => {
    /** @scenario Shows Integration configured alert when firstMessage exists */
    it("returns firstMessage as true", async () => {
      const findById = vi.fn(async () => ({ firstMessage: true }) as never);
      const { caller } = mount({ projects: { findById } });

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).resolves.toEqual({
        firstMessage: true,
      });
      expect(findById).toHaveBeenCalledWith("project_123");
    });
  });

  describe("when a project has not received traces", () => {
    /** @scenario Shows Waiting for messages when no firstMessage */
    it("returns firstMessage as false", async () => {
      const { caller } = mount({
        projects: { findById: async () => ({ firstMessage: false }) as never },
      });

      await expect(caller.getHasFirstMessage({ projectId: "project_123" })).resolves.toEqual({
        firstMessage: false,
      });
    });

    it("answers false rather than 404 for a project that does not exist", async () => {
      const { caller } = mount({ projects: { findById: async () => null } });

      await expect(caller.getHasFirstMessage({ projectId: "nonexistent" })).resolves.toEqual({
        firstMessage: false,
      });
    });
  });

  describe("when the legacy project key is revoked", () => {
    /** @scenario A project manager revokes the legacy project key and is shown no key */
    it("answers that it is revoked, carrying no key, and names the caller", async () => {
      const { caller, revokeProjectApiKey } = mount();

      await expect(caller.revokeProjectApiKey({ projectId: "project_123" })).resolves.toEqual({
        revoked: true,
      });
      expect(revokeProjectApiKey).toHaveBeenCalledWith({
        projectId: "project_123",
        by: expect.objectContaining({ id: ACTOR_ID }),
      });
    });

    /** @scenario A member who is not an admin cannot revoke the project key */
    it("refuses a caller who may not manage the project, before anything is revoked", async () => {
      const { caller, revokeProjectApiKey } = mount({
        permits: (permission) => permission !== "project:manage",
      });

      await expect(caller.revokeProjectApiKey({ projectId: "project_123" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(revokeProjectApiKey).not.toHaveBeenCalled();
    });

    /** @scenario A member who is not an admin cannot read the legacy key status */
    it("refuses the status read to a caller who may not manage the project", async () => {
      const { caller, getLegacyKeyStatus } = mount({
        permits: (permission) => permission !== "project:manage",
      });

      await expect(caller.getLegacyKeyStatus({ projectId: "project_123" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(getLegacyKeyStatus).not.toHaveBeenCalled();
    });

    it("answers whether a legacy key is present, and no key", async () => {
      const { caller } = mount();

      await expect(caller.getLegacyKeyStatus({ projectId: "project_123" })).resolves.toEqual({
        present: true,
      });
    });
  });

  describe("when the settings form is saved", () => {
    it("hands every stored-object credential to the application as typed", async () => {
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
          s3Endpoint: "https://s3.example",
          s3AccessKeyId: "AKIA",
          s3SecretAccessKey: "shh",
          s3Bucket: "bucket",
        }),
        expect.objectContaining({ id: ACTOR_ID }),
      );
    });

    /** @scenario A blank storage secret leaves the stored secret unchanged */
    it("leaves the stored secret alone when the form sends it blank beside an endpoint", async () => {
      const update = vi.fn(async (_input: unknown) => ({ slug: "my-project" }) as never);
      const { caller } = mount({ projects: { updateSettings: update } });

      await caller.update({
        projectId: "project_123",
        s3Endpoint: "https://s3.example",
        s3AccessKeyId: "AKIA",
        s3SecretAccessKey: "",
      });

      expect(update.mock.calls[0]?.[0]).not.toHaveProperty("s3SecretAccessKey");
    });

    /** @scenario Clearing the storage settings clears the stored secret */
    it("clears the stored secret when the whole storage block is blank", async () => {
      const update = vi.fn(async (_input: unknown) => ({ slug: "my-project" }) as never);
      const { caller } = mount({ projects: { updateSettings: update } });

      await caller.update({ projectId: "project_123", s3SecretAccessKey: "" });

      expect(update.mock.calls[0]?.[0]).toHaveProperty("s3SecretAccessKey", null);
    });

    /** @scenario A storage secret needs an endpoint and a key id */
    it("refuses a secret with no endpoint or key id", async () => {
      const { caller } = mount();

      await expect(
        caller.update({ projectId: "project_123", s3SecretAccessKey: "shh" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
        by: expect.objectContaining({ id: ACTOR_ID }),
      });
    });

    it("refuses a caller who may update the project but not manage it", async () => {
      const update = vi.fn(async () => ({ slug: "my-project" }) as never);
      const { caller } = mount({
        projects: { updateSettings: update },
        probePermission: async () => false,
      });

      await expectRefusal(caller.update({ projectId: "project_123", traceSharingEnabled: true }), {
        code: "permission_denied",
        httpStatus: 403,
      });
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
        by: expect.objectContaining({ id: ACTOR_ID }),
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
    it("returns the slug", async () => {
      const create = vi.fn(async () => ({ id: "project_new", slug: "new-project" }) as never);
      const { caller } = mount({ projects: { create } });

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
    });

    /**
     * Creating INTO a team asks that team for `project:create`; creating a
     * team alongside asks the organization for `organization:manage` — known
     * only once the input is parsed, so the declaration hands it to the handler.
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
        by: expect.objectContaining({ id: ACTOR_ID }),
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
        by: expect.objectContaining({ id: ACTOR_ID }),
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
});
