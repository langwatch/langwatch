/**
 * @vitest-environment node
 *
 * Integration tests for Agents tRPC endpoints.
 * Tests the actual CRUD operations through the tRPC layer.
 * Config formats must be DSL-compatible for direct execution.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

// DSL-compatible config fixtures
const signatureConfig = {
  name: "GPT-4 Assistant",
  llm: {
    model: "openai/gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
  },
  prompt: "You are a helpful assistant",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};

const codeConfig = {
  name: "Python Processor",
  parameters: [
    {
      identifier: "code",
      type: "code",
      value: "def execute(input): return input.upper()",
    },
  ],
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};

const workflowConfig = {
  name: "Pipeline Agent",
  isCustom: true,
  workflow_id: "workflow_test_123",
};

const httpConfig = {
  name: "HTTP Agent",
  description: "External API endpoint",
  url: "https://api.example.com/chat",
  method: "POST" as const,
  bodyTemplate: '{"query": "{{input}}"}',
  outputPath: "$.result",
  inputs: [{ identifier: "input", type: "str" as const }],
  outputs: [{ identifier: "output", type: "str" as const }],
};

describe("Agents Endpoints", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Clean up any existing test agents before running tests
    // This ensures we always start with a clean state
    await prisma.agent.deleteMany({
      where: { projectId },
    });

    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: user.id },
        expires: "1",
      },
    });
    caller = appRouter.createCaller(ctx);
  });

  describe("create", () => {
    it("creates a signature agent with DSL-compatible config", async () => {
      const result = await caller.agents.create({
        projectId,
        name: "GPT-4 Assistant",
        type: "signature",
        config: signatureConfig,
      });

      expect(result.id).toMatch(/^agent_/);
      expect(result.name).toBe("GPT-4 Assistant");
      expect(result.type).toBe("signature");
      expect(result.config).toMatchObject({
        llm: { model: "openai/gpt-4o" },
        prompt: "You are a helpful assistant",
      });
      expect(result.projectId).toBe(projectId);
      expect(result.archivedAt).toBeNull();
    });

    it("creates a code agent with parameters array", async () => {
      const result = await caller.agents.create({
        projectId,
        name: "Python Processor",
        type: "code",
        config: codeConfig,
      });

      expect(result.id).toMatch(/^agent_/);
      expect(result.name).toBe("Python Processor");
      expect(result.type).toBe("code");
      // Verify the code parameter is present
      const config = result.config as typeof codeConfig;
      expect(config.parameters).toBeDefined();
      expect(
        config.parameters?.some(
          (p) => p.identifier === "code" && p.type === "code",
        ),
      ).toBe(true);
    });

    it("creates a workflow agent with workflowId", async () => {
      const result = await caller.agents.create({
        projectId,
        name: "Pipeline Agent",
        type: "workflow",
        config: workflowConfig,
        workflowId: "workflow_test_123",
      });

      expect(result.type).toBe("workflow");
      expect(result.workflowId).toBe("workflow_test_123");
      const config = result.config as typeof workflowConfig;
      expect(config.isCustom).toBe(true);
    });

    it("creates an http agent with DSL-compatible config", async () => {
      const result = await caller.agents.create({
        projectId,
        name: "HTTP Agent",
        type: "http",
        config: httpConfig,
      });

      expect(result.id).toMatch(/^agent_/);
      expect(result.name).toBe("HTTP Agent");
      expect(result.type).toBe("http");
      const config = result.config as typeof httpConfig;
      expect(config.url).toBe("https://api.example.com/chat");
      expect(config.method).toBe("POST");
      expect(config.bodyTemplate).toBeDefined();
      expect(config.outputPath).toBe("$.result");
    });
  });

  describe("getAll", () => {
    it("returns all non-archived agents for project", async () => {
      const result = await caller.agents.getAll({ projectId });

      // Should have at least the agents we created above
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.every((a) => a.projectId === projectId)).toBe(true);
      expect(result.every((a) => a.archivedAt === null)).toBe(true);
    });

    it("returns agents ordered by most recently updated", async () => {
      const result = await caller.agents.getAll({ projectId });

      // Verify descending order by updatedAt
      for (let i = 1; i < result.length; i++) {
        const current = new Date(result[i]!.updatedAt).getTime();
        const previous = new Date(result[i - 1]!.updatedAt).getTime();
        expect(current).toBeLessThanOrEqual(previous);
      }
    });
  });

  describe("getById", () => {
    it("returns agent by id", async () => {
      // First create an agent
      const created = await caller.agents.create({
        projectId,
        name: "Findable Agent",
        type: "signature",
        config: signatureConfig,
      });

      const found = await caller.agents.getById({
        id: created.id,
        projectId,
      });

      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe("Findable Agent");
    });

    it("returns null for non-existent agent", async () => {
      const found = await caller.agents.getById({
        id: "agent_nonexistent",
        projectId,
      });

      expect(found).toBeNull();
    });
  });

  describe("update", () => {
    it("updates agent name", async () => {
      const created = await caller.agents.create({
        projectId,
        name: "Original Name",
        type: "signature",
        config: signatureConfig,
      });

      const updated = await caller.agents.update({
        id: created.id,
        projectId,
        name: "Updated Name",
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe("Updated Name");
    });

    it("updates agent config", async () => {
      const created = await caller.agents.create({
        projectId,
        name: "Config Test",
        type: "signature",
        config: signatureConfig,
      });

      const updatedConfig = {
        ...signatureConfig,
        llm: { ...signatureConfig.llm, model: "gpt-4o", temperature: 0.9 },
      };

      const updated = await caller.agents.update({
        id: created.id,
        projectId,
        config: updatedConfig,
      });

      const config = updated.config as typeof signatureConfig;
      expect(config.llm.model).toBe("gpt-4o");
      expect(config.llm.temperature).toBe(0.9);
    });

    it("updates http agent URL and method", async () => {
      const created = await caller.agents.create({
        projectId,
        name: "HTTP Agent",
        type: "http",
        config: httpConfig,
      });

      const updatedConfig = {
        ...httpConfig,
        url: "https://api.example.com/v2/chat",
        method: "PUT" as const,
      };

      const updated = await caller.agents.update({
        id: created.id,
        projectId,
        config: updatedConfig,
      });

      const config = updated.config as typeof httpConfig;
      expect(config.url).toBe("https://api.example.com/v2/chat");
      expect(config.method).toBe("PUT");
    });
  });

  describe("delete (soft delete)", () => {
    it("soft deletes an agent by setting archivedAt", async () => {
      const created = await caller.agents.create({
        projectId,
        name: "To Be Deleted",
        type: "signature",
        config: signatureConfig,
      });

      const deleted = await caller.agents.delete({
        id: created.id,
        projectId,
      });

      expect(deleted.archivedAt).not.toBeNull();
    });

    it("soft deleted agents are excluded from getAll", async () => {
      const created = await caller.agents.create({
        projectId,
        name: "Will Be Hidden",
        type: "signature",
        config: signatureConfig,
      });

      await caller.agents.delete({
        id: created.id,
        projectId,
      });

      const all = await caller.agents.getAll({ projectId });
      const found = all.find((a) => a.id === created.id);

      expect(found).toBeUndefined();
    });

    it("soft deleted agents are excluded from getById", async () => {
      const created = await caller.agents.create({
        projectId,
        name: "Will Be Hidden From GetById",
        type: "signature",
        config: signatureConfig,
      });

      await caller.agents.delete({
        id: created.id,
        projectId,
      });

      const found = await caller.agents.getById({
        id: created.id,
        projectId,
      });

      expect(found).toBeNull();
    });
  });
});
