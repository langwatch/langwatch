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

import { createHandle } from "./helpers";

import {
  llmPromptConfigFactory,
  llmPromptConfigVersionFactory,
} from "~/factories/llm-config.factory";
import { projectFactory } from "~/factories/project.factory";

describe("Prompts API", () => {
  let mockConfig: LlmPromptConfig;
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      put: (path: string, body: any) => Response | Promise<Response>;
      post: (path: string, body: any) => Response | Promise<Response>;
      get: (path: string) => Response | Promise<Response>;
      delete: (path: string) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

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

    helpers = {
      api: {
        get: (path: string) =>
          app.request(path, { headers: { "X-Auth-Token": testApiKey } }),
        post: (path: string, body: any) =>
          app.request(path, {
            method: "POST",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        put: (path: string, body: any) =>
          app.request(path, {
            method: "PUT",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        delete: (path: string) =>
          app.request(path, {
            method: "DELETE",
            headers: createAuthHeaders(testApiKey),
          }),
      },
    };
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
        config = await prisma.llmPromptConfig.create({
          data: mockConfig,
        });

        await prisma.llmPromptConfigVersion.create({
          data: llmPromptConfigVersionFactory.build({
            configId: config.id,
            projectId: testProjectId,
          }),
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
        const handle = createHandle("ref");

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
          expect(createBody.handle).toBe(handle);
        });

        it("should get a single prompt by handle", async () => {
          // Get the prompt by handle
          const res = await app.request(`/api/prompts/${handle}`, {
            headers: { "X-Auth-Token": testApiKey },
          });

          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.handle).toBe(handle);
        });
      });

      describe("when the prompt is scoped to organization", () => {
        // Create a new prompt with organization scope and handle
        const handle = createHandle("org_ref");

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
          expect(createBody.handle).toBe(handle);
          expect(createBody.scope).toBe("ORGANIZATION");
        });

        it("should get a single prompt by handle", async () => {
          // Get the prompt by handle
          const res = await app.request(`/api/prompts/${handle}`, {
            headers: { "X-Auth-Token": testApiKey },
          });

          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.handle).toBe(handle);
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
            expect(body[0].model).toBe("openai/gpt-4o-mini");
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
        body: JSON.stringify({ handle: "test-handle/chunky-bacon" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("id");
      expect(body).toHaveProperty("handle", "test-handle/chunky-bacon");
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
        expect(body).toHaveProperty("handle", "my-custom-ref");
      });
    });

    describe("when scoping by organization", () => {
      it("should create a new prompt with a handle scoped to organization", async () => {
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
        expect(body).toHaveProperty("handle", "my-custom-ref");
      });
    });
  });

  // PUT endpoints tests
  describe("PUT endpoints", () => {
    describe("when updating a prompt", () => {
      it("should allow duplicate handles across different scopes", async () => {
        // Create first prompt with organization scope
        const prompt1Res = await helpers.api.post(`/api/prompts`, {
          name: "Test Prompt 1",
          handle: "shared-ref",
          scope: "ORGANIZATION",
        });
        expect(prompt1Res.status).toBe(200);
        const prompt1 = await prompt1Res.json();
        expect(prompt1.handle).toBe("shared-ref");
        expect(prompt1.scope).toBe("ORGANIZATION");

        // Create second prompt with project scope using same handle - should succeed
        const prompt2Res = await helpers.api.post(`/api/prompts`, {
          name: "Test Prompt 2",
          handle: "shared-ref",
          scope: "PROJECT",
        });

        expect(prompt2Res.status).toBe(200);
        const prompt2 = await prompt2Res.json();
        expect(prompt2.handle).toBe("shared-ref");
        expect(prompt2.scope).toBe("PROJECT");
      });

      describe("with project scope (default)", () => {
        it("should updte a prompt with a handle in correct format", async () => {
          // Create a valid prompt first
          const promptRes = await helpers.api.post(`/api/prompts`, {
            handle: "my-custom-ref",
          });

          expect(promptRes.status).toBe(200);
          const prompt = await promptRes.json();

          // Update the prompt with a handle
          const updateRes = await helpers.api.put(`/api/prompts/${prompt.id}`, {
            handle: "my-custom-ref-updated",
          });

          const updateBody = await updateRes.json();
          expect(updateBody.handle).toBe("my-custom-ref-updated");

          const realPrompt = await prisma.llmPromptConfig.findUnique({
            where: { id: prompt.id, projectId: testProjectId },
          });

          // Verify the handle is in the correct format
          expect(realPrompt?.handle).toBe(
            `${testProjectId}/my-custom-ref-updated`
          );
        });

        it("should enforce unique handle constraint", async () => {
          // Create first prompt with handle
          const prompt1Res = await helpers.api.post(`/api/prompts`, {
            handle: "first-ref",
          });

          expect(prompt1Res.status).toBe(200);
          const prompt1 = await prompt1Res.json();

          // Create second prompt
          await helpers.api.post(`/api/prompts`, {
            handle: "second-ref",
          });

          // Set handle on first prompt
          const updateRes = await helpers.api.put(
            `/api/prompts/${prompt1.id}`,
            {
              handle: "second-ref",
            }
          );

          // Should fail because the handle is already taken
          expect(updateRes.status).toBe(409);
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

      it("should support updating all supported fields", async () => {
        // Create initial prompt with all fields
        const createRes = await app.request(`/api/prompts`, {
          method: "POST",
          headers: {
            "X-Auth-Token": testApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Initial Prompt",
            handle: "update-all-fields-test",
            scope: "PROJECT",
            prompt: "Initial prompt text with {{variable}}",
            messages: [
              { role: "system", content: "Initial system message" },
              { role: "user", content: "Initial user message with {{input}}" },
            ],
            inputs: [
              { identifier: "variable", type: "str" },
              { identifier: "input", type: "str" },
            ],
            outputs: [
              {
                identifier: "response",
                type: "str",
                json_schema: { type: "string" },
              },
            ],
          }),
        });

        expect(createRes.status).toBe(200);
        const createdPrompt = await createRes.json();

        // Update all supported fields
        const updateRes = await app.request(
          `/api/prompts/${createdPrompt.id}`,
          {
            method: "PUT",
            headers: {
              "X-Auth-Token": testApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              handle: "updated-all-fields-test",
              scope: "ORGANIZATION",
              prompt: "Updated prompt text with {{new_variable}}",
              messages: [
                { role: "system", content: "Updated system message" },
                {
                  role: "user",
                  content: "Updated user message with {{new_input}}",
                },
                { role: "assistant", content: "Example response" },
              ],
              inputs: [
                { identifier: "new_variable", type: "str" },
                { identifier: "new_input", type: "str" },
                { identifier: "additional_param", type: "number" },
              ],
              outputs: [
                {
                  identifier: "updated_response",
                  type: "str",
                  json_schema: { type: "string" },
                },
                {
                  identifier: "metadata",
                  type: "object",
                  json_schema: { type: "object" },
                },
              ],
            }),
          }
        );

        expect(updateRes.status).toBe(200);
        const updatedPrompt = await updateRes.json();

        // Verify all fields were updated
        expect(updatedPrompt.handle).toBe("updated-all-fields-test");
        expect(updatedPrompt.scope).toBe("ORGANIZATION");
        expect(updatedPrompt.latestVersion.configData.prompt).toBe(
          "Updated prompt text with {{new_variable}}"
        );
        expect(updatedPrompt.latestVersion.configData.messages).toHaveLength(3);
        expect(updatedPrompt.latestVersion.configData.messages[0].content).toBe(
          "Updated system message"
        );
        expect(updatedPrompt.latestVersion.configData.inputs).toHaveLength(3);
        expect(
          updatedPrompt.latestVersion.configData.inputs[2].identifier
        ).toBe("additional_param");
        expect(updatedPrompt.latestVersion.configData.outputs).toHaveLength(2);
        expect(
          updatedPrompt.latestVersion.configData.outputs[0].identifier
        ).toBe("updated_response");
      });

      describe("when setting the prompt", () => {
        it("should replace the prompt", async () => {
          // Create a prompt with initial data
          const createRes = await app.request(`/api/prompts`, {
            method: "POST",
            headers: {
              "X-Auth-Token": testApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              handle: "prompt-replacement-test",
              prompt: "Original prompt text",
              messages: [
                { role: "system", content: "Original system message" },
                { role: "user", content: "Original user message" },
              ],
            }),
          });

          expect(createRes.status).toBe(200);
          const createdPrompt = await createRes.json();

          // Update with new prompt
          const updateRes = await app.request(
            `/api/prompts/${createdPrompt.id}`,
            {
              method: "PUT",
              headers: {
                "X-Auth-Token": testApiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: "New prompt text with {{variable}}",
              }),
            }
          );

          expect(updateRes.status).toBe(200);
          const updatedPrompt = await updateRes.json();

          // Verify prompt was replaced
          expect(updatedPrompt.latestVersion.configData.prompt).toBe(
            "New prompt text with {{variable}}"
          );
          // Verify messages remain unchanged
          expect(updatedPrompt.latestVersion.configData.messages).toHaveLength(
            2
          );
          expect(
            updatedPrompt.latestVersion.configData.messages[0].content
          ).toBe("Original system message");
        });

        it("should replace the system message", async () => {
          // Create a prompt with initial data
          const createRes = await app.request(`/api/prompts`, {
            method: "POST",
            headers: {
              "X-Auth-Token": testApiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              handle: "system-message-replacement-test",
              prompt: "Original prompt text",
              messages: [
                { role: "system", content: "Original system message" },
                { role: "user", content: "Original user message" },
              ],
            }),
          });

          expect(createRes.status).toBe(200);
          const createdPrompt = await createRes.json();

          // Update with new prompt
          const updateRes = await app.request(
            `/api/prompts/${createdPrompt.id}`,
            {
              method: "PUT",
              headers: {
                "X-Auth-Token": testApiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                prompt: "New prompt replaces system message",
              }),
            }
          );

          expect(updateRes.status).toBe(200);
          const updatedPrompt = await updateRes.json();

          // Verify prompt was set and system message was replaced
          expect(updatedPrompt.latestVersion.configData.prompt).toBe(
            "New prompt replaces system message"
          );
          // System message should be replaced/removed when prompt is set
          const systemMessages =
            updatedPrompt.latestVersion.configData.messages?.filter(
              (msg: any) => msg.role === "system"
            );
          expect(systemMessages).toHaveLength(0);
        });
      });

      describe("when setting the messages with a system message", () => {
        it.only("should replace the system message", async () => {
          // Create a prompt with initial data
          const createRes = await helpers.api.post(`/api/prompts`, {
            handle: "messages-system-replacement-test",
            prompt: "Original prompt text",
            // For now, when creating a prompt, inputs and outputs are required.
            messages: [
              { role: "system", content: "Original system message" },
              { role: "user", content: "{{input}}" },
            ],
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          });

          expect(createRes.status).toBe(200);
          const createdPrompt = await createRes.json();

          // Update with new messages including system message
          const updateRes = await helpers.api.put(
            `/api/prompts/${createdPrompt.id}`,
            {
              messages: [
                { role: "system", content: "New system message" },
                { role: "user", content: "New user message" },
              ],
            }
          );

          expect(updateRes.status).toBe(200);
          const updatedPrompt = await updateRes.json();

          console.log(updatedPrompt.messages);

          // Verify messages were replaced
          expect(updatedPrompt.messages).toHaveLength(2);
          expect(
            updatedPrompt.latestVersion.configData.messages[0].content
          ).toBe("New system message");
          expect(
            updatedPrompt.latestVersion.configData.messages[1].content
          ).toBe("New user message");
          // Verify original prompt remains unchanged
          expect(updatedPrompt.latestVersion.configData.prompt).toBe(
            "Original prompt text"
          );
        });

        it("should replace the prompt", async () => {
          // Create a prompt with initial data
          const createRes = await helpers.api.post(`/api/prompts`, {
            handle: "messages-prompt-replacement-test",
            prompt: "Original prompt text",
            messages: [
              { role: "system", content: "Original system message" },
              { role: "user", content: "Original user message" },
            ],
          });

          expect(createRes.status).toBe(200);
          const createdPrompt = await createRes.json();

          // Update with new messages including system message
          const updateRes = await app.request(
            `/api/prompts/${createdPrompt.id}`,
            {
              method: "PUT",
              headers: {
                "X-Auth-Token": testApiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messages: [
                  { role: "system", content: "System message replaces prompt" },
                  { role: "user", content: "New user message" },
                ],
              }),
            }
          );

          expect(updateRes.status).toBe(200);
          const updatedPrompt = await updateRes.json();

          // Verify messages were set and prompt was replaced/removed
          expect(updatedPrompt.latestVersion.configData.messages).toHaveLength(
            2
          );
          expect(
            updatedPrompt.latestVersion.configData.messages[0].content
          ).toBe("System message replaces prompt");
          // Prompt should be replaced/removed when messages with system message are set
          expect(updatedPrompt.latestVersion.configData.prompt).toBeUndefined();
        });
      });
    });
  });

  // DELETE endpoints tests
  describe("DELETE endpoints", () => {
    let promptToDelete: LlmPromptConfig;

    beforeEach(async () => {
      // Create a prompt first
      const createRes = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          handle: "delete-by-id-test",
        }),
      });

      expect(createRes.status).toBe(200);
      promptToDelete = await createRes.json();
    });

    it("should require authentication to delete a prompt", async () => {
      const deleteRes = await app.request(`/api/prompts/some-id`, {
        method: "DELETE",
      });

      expect(deleteRes.status).toBe(401);
    });

    it("should delete a prompt by ID", async () => {
      // Delete the prompt by ID
      const deleteRes = await app.request(`/api/prompts/${promptToDelete.id}`, {
        method: "DELETE",
        headers: {
          "X-Auth-Token": testApiKey,
        },
      });

      expect(deleteRes.status).toBe(200);
      const deleteBody = await deleteRes.json();
      expect(deleteBody).toHaveProperty("success", true);

      // Verify the prompt is deleted by trying to get it
      const getRes = await app.request(`/api/prompts/${promptToDelete.id}`, {
        method: "GET",
        headers: {
          "X-Auth-Token": testApiKey,
        },
      });

      expect(getRes.status).toBe(404);
    });

    it("should delete a prompt by handle", async () => {
      // Delete the prompt by handle
      const deleteRes = await app.request(
        `/api/prompts/${promptToDelete.handle}`,
        {
          method: "DELETE",
          headers: {
            "X-Auth-Token": testApiKey,
          },
        }
      );

      expect(deleteRes.status).toBe(200);
      const deleteBody = await deleteRes.json();
      expect(deleteBody).toHaveProperty("success", true);

      // Verify the prompt is deleted by trying to get it by ID
      const getRes = await app.request(`/api/prompts/${promptToDelete.id}`, {
        method: "GET",
        headers: {
          "X-Auth-Token": testApiKey,
        },
      });

      expect(getRes.status).toBe(404);
    });

    it("should return 404 when trying to delete a non-existent prompt", async () => {
      const deleteRes = await app.request(`/api/prompts/non-existent-id`, {
        method: "DELETE",
        headers: {
          "X-Auth-Token": testApiKey,
        },
      });

      expect(deleteRes.status).toBe(404);
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
        body: JSON.stringify({ handle: "test-handle" }),
      });

      const prompt = await promptRes.json();
      expect(promptRes.status).toBe(200);

      const invalidData = {
        configData: {
          prompt: "Test prompt",
          messages: [],
          // Missing required fields: model, inputs, outputs
          temperature: 0.7,
        },
        commitMessage: "Invalid schema test",
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

    it("should strictly validate input when updating a prompt", async () => {
      // Create a valid prompt first
      const promptRes = await app.request(`/api/prompts`, {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ handle: "test-handle" }),
      });

      const prompt = await promptRes.json();
      expect(promptRes.status).toBe(200);

      // Test with empty data (should fail with "At least one field is required")
      const emptyData = {};

      const res = await app.request(`/api/prompts/${prompt.id}`, {
        method: "PUT",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(emptyData),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toContain("At least one field is required");
    });

    it("should return 400 if no fields are provided", async () => {
      const res = await app.request(`/api/prompts/${mockConfig.id}`, {
        method: "PUT",
        headers: { "X-Auth-Token": testApiKey },
      });
      expect(res.status).toBe(400);
    });
  });
});
