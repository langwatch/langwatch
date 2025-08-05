import type { Organization, Project, Team } from "@prisma/client";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { prisma } from "~/server/db";

import { app } from "../[[...route]]/app";

import { organizationFactory, projectFactory, teamFactory } from "~/factories";

describe("Prompts API V2", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;

  // Setup and teardown
  beforeEach(async () => {
    // Create organization first
    testOrganization = await prisma.organization.create({
      data: organizationFactory.build(),
    });

    // Create team linked to the organization
    testTeam = await prisma.team.create({
      data: teamFactory.build({
        organizationId: testOrganization.id,
      }),
    });

    // Create test project in the database with the proper team
    testProject = await prisma.project.create({
      data: projectFactory.build({
        teamId: testTeam.id,
      }),
    });

    // Update variables after project creation to ensure they have the correct values
    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
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
    it.only("should create a new prompt", async () => {
      const res = await app.request(`/api/prompts/v2`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ handle: "test-handle/chunky-bacon" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("handle", "test-handle/chunky-bacon");
    });
  });
});
