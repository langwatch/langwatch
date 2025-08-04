import type { LlmPromptConfig, Organization, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { llmPromptConfigFactory } from "~/factories/llm-config.factory";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { LlmConfigRepository } from "~/server/prompt-config/repositories/llm-config.repository";

import { app } from "./[[...route]]/app";

describe("Prompts API", () => {
  // Test data setup
  let mockProject = projectFactory.build({
    slug: nanoid(),
  });
  let mockConfig = llmPromptConfigFactory.build({
    name: "Test Prompt",
    projectId: mockProject.id,
  });
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;

  // Setup and teardown
  beforeEach(async () => {
    // Create organization first
    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    // Create team linked to the organization
    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    // Create test project in the database with the proper team
    mockProject = await prisma.project.create({
      data: {
        ...mockProject,
        teamId: testTeam.id,
      },
    });

    // Update variables after project creation to ensure they have the correct values
    testApiKey = mockProject.apiKey;
    testProjectId = mockProject.id;

    // Update the mock config with the correct project ID
    mockConfig = llmPromptConfigFactory.build({
      projectId: testProjectId,
    });
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: testProjectId },
    });

    await prisma.project.delete({
      where: { id: testProjectId },
    });

    // Clean up team and organization
    await prisma.team.delete({
      where: { id: testTeam.id },
    });

    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  // Authentication tests
  describe("Authentication", () => {
    it("should return 401 with invalid API key", async () => {
      const res = await app.request(`/api/prompts`, {
        headers: { "X-Auth-Token": "invalid-key" },
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });
  });

  // GET endpoints tests
  describe("GET endpoints", () => {
    describe("when there are no prompts", () => {
      it("should get empty array for a project with no prompts", async () => {
        const res = await app.request(`/api/prompts`, {
          headers: { "X-Auth-Token": testApiKey },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(0);
      });
    });

    describe("when there are prompts", () => {
      let config: LlmPromptConfig;
      beforeEach(async () => {
        const repository = new LlmConfigRepository(prisma);
        config = await repository.createConfigWithInitialVersion({
          name: mockConfig.name,
          projectId: testProjectId,
          organizationId: testOrganization.id,
          scope: "PROJECT",
        });
      });

      afterEach(async () => {
        // Clean up configs
        await prisma.llmPromptConfig.deleteMany({
          where: { projectId: testProjectId },
        });
      });

      it("should get all prompts for a project", async () => {
        const res = await app.request(`/api/prompts`, {
          headers: { "X-Auth-Token": testApiKey },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(config.id);
        expect(body[0].projectId).toBe(testProjectId);
      });

      it("should get a single prompt by ID", async () => {
        const res = await app.request(`/api/prompts/${config.id}`, {
          headers: { "X-Auth-Token": testApiKey },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe(config.id);
      });

      describe("when the prompt is scoped to project (default)", () => {
        // First, update the config to have a handle
        const handle = `ref_${nanoid()}`;

        beforeEach(async () => {
          // Create a new prompt with the handle
          const createRes = await app.request(`/api/prompts`, {
            method: "POST",
            headers: {
              "X-Auth-Token": testApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: "Test Prompt", handle }),
          });

          // Verify the prompt was created with the handle
          expect(createRes.status).toBe(200);
          const createBody = await createRes.json();
          expect(createBody.handle).toBe(`${testProjectId}/${handle}`);
        });

        it("should get a single prompt by handle", async () => {
          // Get the prompt by handle
          const res = await app.request(`/api/prompts/${handle}`, {
            headers: { "X-Auth-Token": testApiKey },
          });

          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.handle).toBe(`${testProjectId}/${handle}`);
        });
      });

      describe("when the prompt is scoped to organization", () => {
        // Create a new prompt with organization scope and handle
        const handle = `org_ref_${nanoid()}`;

        beforeEach(async () => {
          const createRes = await app.request(`/api/prompts`, {
            method: "POST",
            headers: {
              "X-Auth-Token": testApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: "Test Org Prompt",
              handle,
              scope: "ORGANIZATION",
            }),
          });

          // Verify the prompt was created with the organization-scoped handle
          expect(createRes.status).toBe(200);
          const createBody = await createRes.json();
          expect(createBody.handle).toBe(`${testOrganization.id}/${handle}`);
          expect(createBody.scope).toBe("ORGANIZATION");
        });

        it("should get a single prompt by handle", async () => {
          // Get the prompt by handle
          const res = await app.request(`/api/prompts/${handle}`, {
            headers: { "X-Auth-Token": testApiKey },
          });

          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.handle).toBe(`${testOrganization.id}/${handle}`);
          expect(body.scope).toBe("ORGANIZATION");
        });
      });

      it("should return 404 for non-existent prompt ID (should work with handle as well)", async () => {
        const nonExistentId = `prompt_${nanoid()}`;
        const res = await app.request(`/api/prompts/${nonExistentId}`, {
          headers: { "X-Auth-Token": testApiKey },
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body).toHaveProperty("error");
      });

      describe("Prompt Versions - Schema Version 1.0", () => {
        describe("when there are versions for a prompt", () => {
          afterEach(async () => {
            // Clean up versions
            await prisma.llmPromptConfigVersion.deleteMany({
              where: { configId: config.id, projectId: testProjectId },
            });
          });

          it("should get all versions for a prompt", async () => {
            const res = await app.request(
              `/api/prompts/${config.id}/versions`,
              {
                headers: { "X-Auth-Token": testApiKey },
              }
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBe(1);
            expect(body[0].configId).toBe(config.id);
            expect(body[0].projectId).toBe(testProjectId);
            expect(body[0].configData).toHaveProperty(
              "model",
              "openai/gpt-4o-mini"
            );
          });
        });

        describe("when there are no versions for a prompt", () => {
          beforeEach(async () => {
            // Delete all versions for the config
            await prisma.llmPromptConfigVersion.deleteMany({
              where: { configId: config.id, projectId: testProjectId },
            });
          });

          it("should get empty array for a prompt with no versions", async () => {
            const res = await app.request(
              `/api/prompts/${config.id}/versions`,
              {
                headers: { "X-Auth-Token": testApiKey },
              }
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBe(0);
          });
        });
      });
    });
  });

  // POST endpoints tests
  describe("POST endpoints", () => {
    it("should create a new prompt", async () => {
      const res = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: mockConfig.name }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("name", mockConfig.name);
      expect(body).toHaveProperty("projectId", testProjectId);

      // Verify the prompt was actually created in the database
      const createdConfig = await prisma.llmPromptConfig.findUnique({
        where: { id: body.id, projectId: testProjectId },
      });
      expect(createdConfig).not.toBeNull();
      expect(createdConfig?.name).toBe(mockConfig.name);
    });

    it("should validate input when creating a prompt", async () => {
      const invalidData = {
        // Missing required name field
        configData: { model: "gpt-4" },
        schemaVersion: "1.0",
      };

      const res = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidData),
      });

      expect(res.status).toBe(400); // Should be 400 Bad Request
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    describe("when scoping by project (default)", () => {
      it("should create a new prompt with a handle scoped to project", async () => {
        const res = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Test Prompt",
            handle: "my-custom-ref",
          }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("name", "Test Prompt");
        expect(body).toHaveProperty("handle", `${testProjectId}/my-custom-ref`);
      });
    });

    describe("when scoping by organization", () => {
      it("should create a new prompt with a handle scoped to project", async () => {
        const res = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Test Prompt",
            handle: "my-custom-ref",
            scope: "ORGANIZATION",
          }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("name", "Test Prompt");
        expect(body).toHaveProperty(
          "handle",
          `${testOrganization.id}/my-custom-ref`
        );
      });
    });
  });

  // PUT endpoints tests
  describe("PUT endpoints", () => {
    it("should allow duplicate handles across different scopes", async () => {
      // Create first prompt with organization scope
      const prompt1Res = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Test Prompt 1",
          handle: "shared-ref",
          scope: "ORGANIZATION",
        }),
      });

      expect(prompt1Res.status).toBe(200);
      const prompt1 = await prompt1Res.json();
      expect(prompt1.handle).toBe(`${testOrganization.id}/shared-ref`);
      expect(prompt1.scope).toBe("ORGANIZATION");

      // Create second prompt with project scope using same handle - should succeed
      const prompt2Res = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Test Prompt 2",
          handle: "shared-ref",
          scope: "PROJECT",
        }),
      });

      expect(prompt2Res.status).toBe(200);
      const prompt2 = await prompt2Res.json();
      expect(prompt2.handle).toBe(`${testProjectId}/shared-ref`);
      expect(prompt2.scope).toBe("PROJECT");
    });

    describe("with project scope (default)", () => {
      it("should update a prompt with a handle in correct format", async () => {
        // Create a valid prompt first
        const promptRes = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "Test Prompt" }),
        });

        expect(promptRes.status).toBe(200);
        const prompt = await promptRes.json();

        // Get the project with organization info to construct expected handle
        const project = await prisma.project.findUnique({
          where: { id: testProjectId },
          include: { team: { include: { organization: true } } },
        });

        const handle = "my-custom-ref";
        const expectedHandle = `${testProjectId}/${handle}`;

        // Update the prompt with a handle
        const updateRes = await app.request(`/api/prompts/${prompt.id}`, {
          method: "PUT",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Updated Test Prompt",
            handle: handle,
          }),
        });

        expect(updateRes.status).toBe(200);
        const realPrompt = await prisma.llmPromptConfig.findUnique({
          where: { id: prompt.id, projectId: testProjectId },
        });

        // Verify the handle is in the correct format
        expect(realPrompt?.handle).toBe(expectedHandle);
      });

      it("should enforce unique handle constraint", async () => {
        // Create first prompt with handle
        const prompt1Res = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "Test Prompt 1" }),
        });

        const prompt1 = await prompt1Res.json();

        // Create second prompt
        const prompt2Res = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "Test Prompt 2" }),
        });

        const prompt2 = await prompt2Res.json();

        // Set handle on first prompt
        const updateRes1 = await app.request(`/api/prompts/${prompt1.id}`, {
          method: "PUT",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Test Prompt 1",
            handle: "duplicate-ref",
          }),
        });

        expect(updateRes1.status).toBe(200);

        // Try to set same handle on second prompt - should fail
        const updateRes2 = await app.request(`/api/prompts/${prompt2.id}`, {
          method: "PUT",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Test Prompt 2",
            handle: "duplicate-ref",
          }),
        });

        expect(updateRes2.status).toBe(409);
      });
    });
    describe("when scoped to organization", () => {
      it("should prevent duplicate handles within the same organization", async () => {
        // Create first prompt with organization scope
        const prompt1Res = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Test Prompt 1",
            handle: "org-duplicate-ref",
            scope: "ORGANIZATION",
          }),
        });

        expect(prompt1Res.status).toBe(200);

        // Try to create second prompt with same handle and organization scope - should fail
        const prompt2Res = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Test Prompt 2",
            handle: "org-duplicate-ref",
            scope: "ORGANIZATION",
          }),
        });

        expect(prompt2Res.status).toBe(409);
      });
    });
  });

  // Validation/unhappy path tests
  describe("Validation tests", () => {
    it("should validate input when creating a prompt", async () => {
      const invalidData = {
        name: "", // Empty name should be rejected
      };

      const res = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidData),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("should validate input when creating a prompt version", async () => {
      // Create a valid prompt first
      const promptRes = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Test Prompt" }),
      });

      const prompt = await promptRes.json();

      const invalidData = {
        schemaVersion: "1.0",
        configData: {
          // Missing required model field
          temperature: 0.7,
        },
        commitMessage: "Invalid schema",
      };

      const res = await app.request(`/api/prompts/${prompt.id}/versions`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidData),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    it("should validate input when updating a prompt", async () => {
      // Create a valid prompt first
      const promptRes = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Test Prompt" }),
      });

      const prompt = await promptRes.json();

      const invalidData = {
        name: "", // Empty name should be rejected
      };

      const res = await app.request(`/api/prompts/${prompt.id}`, {
        method: "PUT",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invalidData),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
    });
  });
});
