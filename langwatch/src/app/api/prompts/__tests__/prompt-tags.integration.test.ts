import type {
  LlmPromptConfig,
  LlmPromptConfigVersion,
  Organization,
  Project,
  Team,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

describe("Prompt Tags REST API (/api/prompts/tags)", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testApiKey: string;
  let promptConfig: LlmPromptConfig;
  let promptVersion: LlmPromptConfigVersion;

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  function get(path: string) {
    return app.request(path, {
      headers: { "X-Auth-Token": testApiKey },
    });
  }

  function post(path: string, body: unknown) {
    return app.request(path, {
      method: "POST",
      headers: createAuthHeaders(testApiKey),
      body: JSON.stringify(body),
    });
  }

  function put(path: string, body: unknown) {
    return app.request(path, {
      method: "PUT",
      headers: createAuthHeaders(testApiKey),
      body: JSON.stringify(body),
    });
  }

  function del(path: string) {
    return app.request(path, {
      method: "DELETE",
      headers: { "X-Auth-Token": testApiKey },
    });
  }

  beforeEach(async () => {
    const slug = nanoid();

    testOrganization = await prisma.organization.create({
      data: { name: "Test Org", slug: `test-org-${slug}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${slug}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `test-project-${slug}` }),
        teamId: testTeam.id,
      },
    });

    testApiKey = testProject.apiKey;

    const configData = llmPromptConfigFactory.build({
      projectId: testProject.id,
      organizationId: testOrganization.id,
      handle: `test-handle-${nanoid()}`,
    });

    promptConfig = await prisma.llmPromptConfig.create({
      data: {
        id: configData.id,
        name: configData.name,
        projectId: testProject.id,
        organizationId: testOrganization.id,
        handle: configData.handle,
        scope: configData.scope,
      },
    });

    const versionData = llmPromptConfigVersionFactory.build({
      configId: promptConfig.id,
      projectId: testProject.id,
    });

    promptVersion = await prisma.llmPromptConfigVersion.create({
      data: {
        id: versionData.id,
        configId: promptConfig.id,
        projectId: testProject.id,
        version: versionData.version,
        schemaVersion: versionData.schemaVersion,
        configData: versionData.configData as any,
        commitMessage: versionData.commitMessage,
        authorId: null,
      },
    });
  });

  afterEach(async () => {
    await prisma.promptTag.deleteMany({
      where: { organizationId: testOrganization.id },
    });

    await prisma.promptTagAssignment.deleteMany({
      where: { projectId: testProject.id },
    });

    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: testProject.id },
    });

    await prisma.project.delete({ where: { id: testProject.id } });

    await prisma.team.delete({ where: { id: testTeam.id } });

    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  // --- GET /api/prompts/tags ---

  describe("GET /api/prompts/tags", () => {
    describe("when org has custom tags", () => {
      it("returns tags with id, name, and createdAt", async () => {
        await prisma.promptTag.createMany({
          data: [
            { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "canary" },
            { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "ab-test" },
          ],
        });

        const res = await get("/api/prompts/tags");

        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<{ id: string; name: string; createdAt: string }>;
        const names = body.map((t) => t.name);
        expect(names).toContain("canary");
        expect(names).toContain("ab-test");
        for (const tag of body) {
          expect(tag.id).toBeDefined();
          expect(tag.createdAt).toBeDefined();
        }
      });
    });

    describe("when org has no custom tags", () => {
      it("returns an empty array", async () => {
        const res = await get("/api/prompts/tags");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual([]);
      });
    });
  });

  // --- POST /api/prompts/tags ---

  describe("POST /api/prompts/tags", () => {
    describe("when creating a valid custom tag", () => {
      it("returns 201 with id and name", async () => {
        const res = await post("/api/prompts/tags", { name: "canary" });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toMatchObject({ name: "canary" });
        expect(body.id).toBeDefined();
      });
    });

    describe("when name is purely numeric", () => {
      it("returns 422", async () => {
        const res = await post("/api/prompts/tags", { name: "42" });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/numeric/i);
      });
    });

    describe("when name is empty", () => {
      it("returns 422", async () => {
        const res = await post("/api/prompts/tags", { name: "" });

        expect(res.status).toBe(422);
      });
    });

    describe("when name already exists in the org", () => {
      it("returns 409 conflict", async () => {
        await prisma.promptTag.create({
          data: { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "canary" },
        });

        const res = await post("/api/prompts/tags", { name: "canary" });

        expect(res.status).toBe(409);
      });
    });

    describe("when name clashes with a protected tag", () => {
      it("returns 422 mentioning protected for 'latest'", async () => {
        const res = await post("/api/prompts/tags", { name: "latest" });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/protected/i);
      });
    });
  });

  // --- PUT /api/prompts/tags/:tag ---

  describe("PUT /api/prompts/tags/:tag", () => {
    describe("when renaming a valid tag", () => {
      it("returns 200 with new name", async () => {
        await prisma.promptTag.create({
          data: { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "canary" },
        });

        const res = await put("/api/prompts/tags/canary", { name: "beta" });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("beta");
      });
    });

    describe("when old tag does not exist", () => {
      it("returns 404", async () => {
        const res = await put("/api/prompts/tags/nonexistent", { name: "beta" });

        expect(res.status).toBe(404);
      });
    });

    describe("when new name is invalid", () => {
      it("returns 422", async () => {
        await prisma.promptTag.create({
          data: { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "canary" },
        });

        const res = await put("/api/prompts/tags/canary", { name: "INVALID" });

        expect(res.status).toBe(422);
      });
    });

    describe("when renaming a protected tag", () => {
      it("returns 422 mentioning protected", async () => {
        const res = await put("/api/prompts/tags/latest", { name: "beta" });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/protected/i);
      });
    });
  });

  // --- DELETE /api/prompts/tags/:tag ---

  describe("DELETE /api/prompts/tags/:tag", () => {
    describe("when deleting an existing custom tag", () => {
      it("returns 204", async () => {
        await prisma.promptTag.create({
          data: { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "canary" },
        });

        const res = await del("/api/prompts/tags/canary");

        expect(res.status).toBe(204);

        const found = await prisma.promptTag.findFirst({
          where: { organizationId: testOrganization.id, name: "canary" },
        });
        expect(found).toBeNull();
      });
    });

    describe("when deleting a tag with assignments", () => {
      it("cascades to remove PromptTagAssignment rows", async () => {
        await prisma.promptTag.create({
          data: { id: `ptag_${nanoid()}`, organizationId: testOrganization.id, name: "canary" },
        });

        await prisma.promptTagAssignment.create({
          data: {
            id: `vtag_${nanoid()}`,
            configId: promptConfig.id,
            versionId: promptVersion.id,
            tag: "canary",
            projectId: testProject.id,
          },
        });

        const res = await del("/api/prompts/tags/canary");

        expect(res.status).toBe(204);

        const assignment = await prisma.promptTagAssignment.findFirst({
          where: { configId: promptConfig.id, tag: "canary", projectId: testProject.id },
        });
        expect(assignment).toBeNull();
      });
    });

    describe("when tag does not exist", () => {
      it("returns 404", async () => {
        const res = await del("/api/prompts/tags/nonexistent");

        expect(res.status).toBe(404);
      });
    });

    describe("when attempting to delete the 'latest' protected tag", () => {
      it("returns 422 mentioning protected", async () => {
        const res = await del("/api/prompts/tags/latest");

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.message).toMatch(/protected/i);
      });
    });
  });
});
