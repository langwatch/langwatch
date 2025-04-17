import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { app } from "./app";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "../../../../server/db";
import { nanoid } from "nanoid";
import { llmPromptConfigFactory } from "~/factories/llm-config.factory";

describe("Prompts API", () => {
  // Test data setup
  let mockProject = projectFactory.build({
    slug: nanoid(),
  });
  let mockConfig = llmPromptConfigFactory.build({
    projectId: mockProject.id,
  });
  let testApiKey: string;
  let testProjectId: string;

  // Setup and teardown
  beforeEach(async () => {
    // Create test project in the database
    mockProject = await prisma.project.create({
      data: {
        ...mockProject,
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
      beforeEach(async () => {
        // Create a config in the database
        await prisma.llmPromptConfig.create({
          data: {
            ...mockConfig,
          },
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
        expect(body[0].id).toBe(mockConfig.id);
        expect(body[0].projectId).toBe(testProjectId);
      });

      describe("Prompt Versions - Schema Version 1.0", () => {
        describe("when there are versions for a prompt", () => {
          beforeEach(async () => {
            // Create a version for the config
            await prisma.llmPromptConfigVersion.create({
              data: {
                configId: mockConfig.id,
                projectId: testProjectId,
                schemaVersion: "1.0",
                configData: { model: "gpt-4", temperature: 0.7 },
                commitMessage: "Initial version",
              },
            });
          });

          afterEach(async () => {
            // Clean up versions
            await prisma.llmPromptConfigVersion.deleteMany({
              where: { configId: mockConfig.id, projectId: testProjectId },
            });
          });

          it("should get all versions for a prompt", async () => {
            const res = await app.request(
              `/api/prompts/${mockConfig.id}/versions`,
              {
                headers: { "X-Auth-Token": testApiKey },
              }
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBe(1);
            expect(body[0].configId).toBe(mockConfig.id);
            expect(body[0].projectId).toBe(testProjectId);
            expect(body[0].configData).toHaveProperty("model", "gpt-4");
          });
        });

        describe("when there are no versions for a prompt", () => {
          it("should get empty array for a prompt with no versions", async () => {
            const res = await app.request(
              `/api/prompts/${mockConfig.id}/versions`,
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
  });
});
