import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { prisma } from "../../../../server/db";
import { getTestProject } from "../../../../utils/testUtils";
import { app } from "./app";

/**
 * Integration tests for the LLM Configs API
 *
 * Each test is focused on a single responsibility (SOLID):
 * - Getting all configs
 * - Getting a specific config
 * - Creating a new config
 * - Creating a new version
 * - Updating a config
 * - Deleting a config
 *
 * Tests are isolated but sequential to reduce test setup overhead
 */
describe("LLM Configs API", () => {
  // Test data state
  let project: Project;
  let configId: string;
  let versionId: string;

  // Set up test environment
  beforeAll(async () => {
    // Create a test project with a unique namespace
    project = await getTestProject("llm-configs-api");

    // Clean up any existing test data
    await prisma.llmPromptConfigVersion.deleteMany({
      where: { projectId: project.id },
    });

    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: project.id },
    });
  });

  // Clean up after all tests
  afterAll(async () => {
    // Clean up created test data
    await prisma.llmPromptConfigVersion.deleteMany({
      where: { projectId: project.id },
    });

    await prisma.llmPromptConfig.deleteMany({
      where: { projectId: project.id },
    });
  });

  // Test the creation of a new LLM config
  test.only("should create a new LLM config with initial version", async () => {
    // Test data
    const configName = `Test Config ${nanoid(6)}`;
    const configData = { model: "gpt-4", temperature: 0.7 };
    const schemaVersion = "1.0";

    // Send request to create config
    const response = await fetch(
      `http://localhost:5560/project/${project.id}/configs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project.apiKey,
        },
        body: JSON.stringify({
          name: configName,
          configData,
          schemaVersion,
          commitMessage: "Initial version",
        }),
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const responseData = await response.json();
    expect(responseData).toHaveProperty("id");
    expect(responseData).toHaveProperty("name", configName);
    expect(responseData).toHaveProperty("projectId", project.id);

    // Store the config ID for subsequent tests
    configId = responseData.id;
  });

  // Test getting all configs for a project
  test("should get all configs for a project", async () => {
    // Send request to get all configs
    const response = await fetch(
      `http://localhost:3000/project/${project.id}/configs`,
      {
        method: "GET",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const configs = await response.json();
    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBeGreaterThan(0);

    // Verify the previously created config is in the list
    const foundConfig = configs.find((config: any) => config.id === configId);
    expect(foundConfig).toBeDefined();
    expect(foundConfig).toHaveProperty("projectId", project.id);
  });

  // Test getting a specific config by ID
  test("should get a specific config by ID", async () => {
    // Send request to get the config by ID
    const response = await fetch(
      `http://localhost:3000/project/${project.id}/configs/${configId}`,
      {
        method: "GET",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const config = await response.json();
    expect(config).toHaveProperty("id", configId);
    expect(config).toHaveProperty("projectId", project.id);
    expect(config).toHaveProperty("versions");
    expect(Array.isArray(config.versions)).toBe(true);

    // Store the version ID for the version-related tests
    if (config.versions && config.versions.length > 0) {
      versionId = config.versions[0].id;
    }
  });

  // Test updating a config
  test("should update a config", async () => {
    // Test data - new name for the config
    const updatedName = `Updated Config ${nanoid(6)}`;

    // Send request to update the config
    const response = await fetch(
      `http://localhost:3000/project/${project.id}/configs/${configId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project.apiKey,
        },
        body: JSON.stringify({
          name: updatedName,
        }),
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const updatedConfig = await response.json();
    expect(updatedConfig).toHaveProperty("id", configId);
    expect(updatedConfig).toHaveProperty("name", updatedName);
  });

  // Test getting versions for a config
  test("should get all versions for a config", async () => {
    // Send request to get versions
    const response = await fetch(
      `http://localhost:3000/project/${project.id}/configs/${configId}/versions`,
      {
        method: "GET",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const versions = await response.json();
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThan(0);

    // Verify the version matches what we expect
    const firstVersion = versions[0];
    expect(firstVersion).toHaveProperty("id");
    expect(firstVersion).toHaveProperty("configId", configId);
    expect(firstVersion).toHaveProperty("projectId", project.id);
  });

  // Test creating a new version for a config
  test("should create a new version for a config", async () => {
    // Test data for the new version
    const newConfigData = { model: "gpt-4", temperature: 0.5, maxTokens: 2000 };
    const schemaVersion = "1.1";
    const commitMessage = "Updated config settings";

    // Send request to create a new version
    const response = await fetch(
      `http://localhost:3000/project/${project.id}/configs/${configId}/versions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project.apiKey,
        },
        body: JSON.stringify({
          configData: newConfigData,
          schemaVersion,
          commitMessage,
        }),
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const newVersion = await response.json();
    expect(newVersion).toHaveProperty("configId", configId);
    expect(newVersion).toHaveProperty("configData", newConfigData);
    expect(newVersion).toHaveProperty("schemaVersion", schemaVersion);
    expect(newVersion).toHaveProperty("commitMessage", commitMessage);
  });

  // Test deleting a config
  test("should delete a config", async () => {
    // Send request to delete the config
    const response = await fetch(
      `http://localhost:3000/project/${project.id}/configs/${configId}`,
      {
        method: "DELETE",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
      }
    );

    // Assertions
    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result).toHaveProperty("success", true);

    // Verify the config is actually deleted
    const verifyResponse = await fetch(
      `http://localhost:3000/project/${project.id}/configs/${configId}`,
      {
        method: "GET",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
      }
    );

    expect(verifyResponse.status).toBe(404);
  });
});
