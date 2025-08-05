import type {
  LlmPromptConfig,
  Organization,
  Project,
  Team,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { prisma } from "~/server/db";

import { app } from "../[[...route]]/app";

import { llmPromptConfigFactory } from "~/factories/llm-config.factory";
import { projectFactory } from "~/factories/project.factory";

describe("Prompts API V2", () => {
  let mockConfig: LlmPromptConfig;
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;

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

    // Test data setup
    testProject = projectFactory.build({
      slug: nanoid(),
    });
    // Create test project in the database with the proper team
    testProject = await prisma.project.create({
      data: {
        ...testProject,
        teamId: testTeam.id,
      },
    });

    // Update variables after project creation to ensure they have the correct values
    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;

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

  // POST endpoints tests
  describe("POST endpoints", () => {
    it("should create a new prompt", async () => {
      const res = await app.request(`/api/prompts/v2`, {
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
  });
});
