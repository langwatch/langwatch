import type {
  LlmPromptConfig,
  LlmPromptConfigVersion,
  Organization,
  Project,
  Team,
  User,
} from "@prisma/client";
import { OrganizationUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";
import { prisma } from "~/server/db";

// Mock next-auth to provide a controllable session
vi.mock("next-auth", async () => {
  const actual = await vi.importActual("next-auth");
  return {
    ...actual,
    getServerSession: vi.fn(),
  };
});

import { getServerSession } from "next-auth";

const mockGetServerSession = vi.mocked(getServerSession);

async function importApp() {
  const mod = await import("../[[...route]]/app");
  return mod.app;
}

async function makeRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const app = await importApp();
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("Custom Prompt Tags API", () => {
  let org: Organization;
  let otherOrg: Organization;
  let team: Team;
  let project: Project;
  let adminUser: User;
  let viewerUser: User;
  let promptConfig: LlmPromptConfig;
  let promptVersion: LlmPromptConfigVersion;

  beforeEach(async () => {
    const slug = nanoid();

    org = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${slug}` },
    });

    otherOrg = await prisma.organization.create({
      data: { name: "Other Org", slug: `other-org-${slug}` },
    });

    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${slug}`,
        organizationId: org.id,
      },
    });

    project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: `test-project-${slug}`,
        apiKey: `test-key-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });

    adminUser = await prisma.user.create({
      data: {
        name: "Admin User",
        email: `admin-${slug}@example.com`,
      },
    });

    viewerUser = await prisma.user.create({
      data: {
        name: "Viewer User",
        email: `viewer-${slug}@example.com`,
      },
    });

    await prisma.organizationUser.create({
      data: {
        userId: adminUser.id,
        organizationId: org.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    await prisma.organizationUser.create({
      data: {
        userId: viewerUser.id,
        organizationId: org.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    const configData = llmPromptConfigFactory.build({
      projectId: project.id,
      organizationId: org.id,
      handle: `test-handle-${nanoid()}`,
    });

    promptConfig = await prisma.llmPromptConfig.create({
      data: {
        id: configData.id,
        name: configData.name,
        projectId: project.id,
        organizationId: org.id,
        handle: configData.handle,
        scope: configData.scope,
      },
    });

    const versionData = llmPromptConfigVersionFactory.build({
      configId: promptConfig.id,
      projectId: project.id,
    });

    promptVersion = await prisma.llmPromptConfigVersion.create({
      data: {
        id: versionData.id,
        configId: promptConfig.id,
        projectId: project.id,
        version: versionData.version,
        schemaVersion: versionData.schemaVersion,
        configData: versionData.configData as any,
        commitMessage: versionData.commitMessage,
        authorId: null,
      },
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();

    await prisma.promptTag.deleteMany({
      where: {
        organizationId: { in: [org.id, otherOrg.id] },
      },
    });

    await prisma.promptVersionLabel.deleteMany({
      where: { projectId: project.id },
    });

    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: project.id },
    });

    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });

    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: [org.id, otherOrg.id] } },
    });

    await prisma.user.deleteMany({
      where: { id: { in: [adminUser.id, viewerUser.id] } },
    });

    await prisma.organization.deleteMany({
      where: { id: { in: [org.id, otherOrg.id] } },
    });
  });

  function asAdmin() {
    mockGetServerSession.mockResolvedValue({
      user: { id: adminUser.id, email: adminUser.email },
      expires: new Date(Date.now() + 3600000).toISOString(),
    } as any);
  }

  function asViewer() {
    mockGetServerSession.mockResolvedValue({
      user: { id: viewerUser.id, email: viewerUser.email },
      expires: new Date(Date.now() + 3600000).toISOString(),
    } as any);
  }

  function unauthenticated() {
    mockGetServerSession.mockResolvedValue(null);
  }

  // --- Create ---

  describe("POST /api/orgs/:orgId/prompt-tags", () => {
    describe("when admin creates a valid custom tag", () => {
      it("returns 201 with id and name", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "canary" },
        );

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toMatchObject({ name: "canary" });
        expect(body.id).toBeDefined();
      });
    });

    describe("when name is purely numeric", () => {
      it("returns 422 with error mentioning non-numeric requirement", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "42" },
        );

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/numeric/i);
      });
    });

    describe("when name is empty", () => {
      it("returns 422", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "" },
        );

        expect(res.status).toBe(422);
      });
    });

    describe("when name has invalid characters", () => {
      it("rejects names with spaces", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "my tag" },
        );

        expect(res.status).toBe(422);
      });

      it("rejects names with slashes", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "can/ary" },
        );

        expect(res.status).toBe(422);
      });

      it("rejects uppercase names", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "CANARY" },
        );

        expect(res.status).toBe(422);
      });
    });

    describe("when name already exists in the org", () => {
      it("returns 409 conflict", async () => {
        asAdmin();

        await prisma.promptTag.create({
          data: {
            id: `ptag_${nanoid()}`,
            organizationId: org.id,
            name: "canary",
          },
        });

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "canary" },
        );

        expect(res.status).toBe(409);
      });
    });

    describe("when name clashes with a built-in tag", () => {
      it("returns 422 with error mentioning built-in", async () => {
        asAdmin();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "production" },
        );

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/built-in/i);
      });
    });

    describe("when user is not an org admin", () => {
      it("returns 403", async () => {
        asViewer();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "canary" },
        );

        expect(res.status).toBe(403);
      });
    });

    describe("when user is not authenticated", () => {
      it("returns 401", async () => {
        unauthenticated();

        const res = await makeRequest(
          "POST",
          `/api/orgs/${org.id}/prompt-tags`,
          { name: "canary" },
        );

        expect(res.status).toBe(401);
      });
    });
  });

  // --- List ---

  describe("GET /api/orgs/:orgId/prompt-tags", () => {
    describe("when org has custom tags", () => {
      it("returns tags with id, name, and createdAt", async () => {
        asAdmin();

        await prisma.promptTag.createMany({
          data: [
            {
              id: `ptag_${nanoid()}`,
              organizationId: org.id,
              name: "canary",
            },
            {
              id: `ptag_${nanoid()}`,
              organizationId: org.id,
              name: "ab-test",
            },
          ],
        });

        const res = await makeRequest(
          "GET",
          `/api/orgs/${org.id}/prompt-tags`,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<{ id: string; name: string; createdAt: string }>;
        const names = body.map((t) => t.name);

        expect(names).toContain("canary");
        expect(names).toContain("ab-test");

        // Each tag has id and createdAt
        for (const tag of body) {
          expect(tag.id).toBeDefined();
          expect(tag.createdAt).toBeDefined();
        }
      });
    });

    describe("when org has no custom tags", () => {
      it("returns an empty array", async () => {
        asAdmin();

        const res = await makeRequest(
          "GET",
          `/api/orgs/${org.id}/prompt-tags`,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<{ name: string }>;

        expect(body).toEqual([]);
      });
    });

    describe("when org isolation is required", () => {
      it("does not return tags from other orgs", async () => {
        asAdmin();

        // Create tag in other org
        await prisma.promptTag.create({
          data: {
            id: `ptag_${nanoid()}`,
            organizationId: otherOrg.id,
            name: "canary",
          },
        });

        const res = await makeRequest(
          "GET",
          `/api/orgs/${org.id}/prompt-tags`,
        );

        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<{ name: string }>;
        const names = body.map((t) => t.name);

        expect(names).not.toContain("canary");
      });
    });
  });

  // --- Delete ---

  describe("DELETE /api/orgs/:orgId/prompt-tags/:tagId", () => {
    describe("when deleting an existing custom tag with no assignments", () => {
      it("returns 204", async () => {
        asAdmin();

        const tag = await prisma.promptTag.create({
          data: {
            id: `ptag_${nanoid()}`,
            organizationId: org.id,
            name: "canary",
          },
        });

        const res = await makeRequest(
          "DELETE",
          `/api/orgs/${org.id}/prompt-tags/${tag.id}`,
        );

        expect(res.status).toBe(204);

        const deleted = await prisma.promptTag.findUnique({
          where: { id: tag.id },
        });
        expect(deleted).toBeNull();
      });
    });

    describe("when deleting a custom tag that has assignments", () => {
      it("cascades to remove PromptVersionLabel rows", async () => {
        asAdmin();

        const tag = await prisma.promptTag.create({
          data: {
            id: `ptag_${nanoid()}`,
            organizationId: org.id,
            name: "canary",
          },
        });

        // Create an assignment
        await prisma.promptVersionLabel.create({
          data: {
            id: `label_${nanoid()}`,
            configId: promptConfig.id,
            versionId: promptVersion.id,
            label: "canary",
            projectId: project.id,
          },
        });

        const res = await makeRequest(
          "DELETE",
          `/api/orgs/${org.id}/prompt-tags/${tag.id}`,
        );

        expect(res.status).toBe(204);

        const assignment = await prisma.promptVersionLabel.findFirst({
          where: { configId: promptConfig.id, label: "canary", projectId: project.id },
        });
        expect(assignment).toBeNull();
      });
    });

    describe("when attempting to delete a protected tag", () => {
      it("returns 422 with error mentioning protected tag", async () => {
        asAdmin();

        const res = await makeRequest(
          "DELETE",
          `/api/orgs/${org.id}/prompt-tags/production`,
        );

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/protected/i);
      });
    });

    describe("when deleting another org's tag", () => {
      it("returns 404", async () => {
        asAdmin();

        const otherTag = await prisma.promptTag.create({
          data: {
            id: `ptag_${nanoid()}`,
            organizationId: otherOrg.id,
            name: "canary",
          },
        });

        const res = await makeRequest(
          "DELETE",
          `/api/orgs/${org.id}/prompt-tags/${otherTag.id}`,
        );

        expect(res.status).toBe(404);
      });
    });
  });
});
