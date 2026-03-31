import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { app } from "../[[...route]]/app";

/**
 * Integration tests for shorthand prompt tag syntax in REST API.
 * @see specs/prompts/shorthand-prompt-label-syntax.feature
 */
describe("Feature: Shorthand prompt tag syntax (REST API)", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;

  const makeRequest = (path: string, options?: RequestInit) =>
    app.request(path, {
      headers: { "X-Auth-Token": testApiKey, "Content-Type": "application/json" },
      ...options,
    });

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = projectFactory.build({ slug: nanoid() });
    testProject = await prisma.project.create({
      data: { ...testProject, teamId: testTeam.id },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
  });

  afterEach(async () => {
    await prisma.promptTagAssignment.deleteMany({ where: { projectId: testProjectId } });
    await prisma.llmPromptConfigVersion.deleteMany({ where: { projectId: testProjectId } });
    await prisma.llmPromptConfig.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  describe("when resolving shorthand in the path", () => {
    it("resolves tag shorthand to the tagged version, not latest", async () => {
      // Create prompt (v1)
      const createRes = await makeRequest("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ handle: "pizza-prompt", prompt: "v1 prompt" }),
      });
      expect(createRes.status).toBe(200);
      const v1 = await createRes.json();

      // Assign production tag to v1
      const tagRes = await makeRequest(
        `/api/prompts/${v1.handle}/tags/production`,
        {
          method: "PUT",
          body: JSON.stringify({ versionId: v1.versionId }),
        },
      );
      expect(tagRes.status).toBe(200);

      // Create v2 (which becomes the latest)
      const updateRes = await makeRequest(`/api/prompts/${v1.handle}`, {
        method: "PUT",
        body: JSON.stringify({ prompt: "v2 prompt" }),
      });
      expect(updateRes.status).toBe(200);
      const v2 = await updateRes.json();
      expect(v2.versionId).not.toBe(v1.versionId);

      // Resolve via shorthand — must return v1 (production), not v2 (latest)
      const shorthandRes = await makeRequest("/api/prompts/pizza-prompt:production");
      expect(shorthandRes.status).toBe(200);
      const body = await shorthandRes.json();
      expect(body.versionId).toBe(v1.versionId);
    });
  });

  describe("when shorthand path conflicts with tag query param", () => {
    it("returns 422 error explaining the conflict", async () => {
      // Create prompt first so it exists
      const createRes = await makeRequest("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ handle: "pizza-prompt", prompt: "v1" }),
      });
      expect(createRes.status).toBe(200);

      const res = await makeRequest(
        "/api/prompts/pizza-prompt:production?tag=staging",
      );
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/conflict/i);
    });
  });

  describe("when shorthand path conflicts with version query param", () => {
    it("returns 422 error explaining the conflict", async () => {
      const createRes = await makeRequest("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ handle: "pizza-prompt", prompt: "v1" }),
      });
      expect(createRes.status).toBe(200);

      const res = await makeRequest(
        "/api/prompts/pizza-prompt:2?version=3",
      );
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(/conflict/i);
    });
  });

  describe("when shorthand is used in the tag-assignment route", () => {
    it("does not parse shorthand from the prompt ID", async () => {
      // Create prompt
      const createRes = await makeRequest("/api/prompts", {
        method: "POST",
        body: JSON.stringify({ handle: "pizza-prompt", prompt: "v1" }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();

      // The tag-assignment route should NOT parse "pizza-prompt" as shorthand
      // It should treat it as a plain ID/handle
      const tagRes = await makeRequest(
        `/api/prompts/pizza-prompt/tags/production`,
        {
          method: "PUT",
          body: JSON.stringify({ versionId: created.versionId }),
        },
      );
      expect(tagRes.status).toBe(200);
      const body = await tagRes.json();
      expect(body.tag).toBe("production");
    });
  });
});
