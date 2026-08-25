import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioClientEvent } from "@langwatch/workflow-contract";

vi.mock("../../../server/db", () => ({
  prisma: {
    project: { findUniqueOrThrow: vi.fn() },
    projectSecret: { findMany: vi.fn() },
  },
}));

vi.mock("../../../utils/encryption", () => ({
  encrypt: vi.fn((v: string) => `encrypted:${v}`),
  decrypt: vi.fn((v: string) => v.replace("encrypted:", "")),
}));

vi.mock("../../../server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn(),
}));

import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../../server/api/routers/modelProviders.utils";
import { prisma } from "../../../server/db";
import { decrypt } from "../../../utils/encryption";
import {
  testManagedProviders,
  testModelProviders,
} from "../../../server/modelProviders/__tests__/model-provider-services.test-support";
import { addEnvs, LlmModelNotSetError } from "../addEnvs";

const PROJECT_ID = "project-123";
const API_KEY = "test-api-key";

const makeExecuteComponentEvent = ({
  workflowId = "wf-1",
  nodes = [],
}: {
  workflowId?: string;
  nodes?: any[];
} = {}): StudioClientEvent =>
  ({
    type: "execute_component",
    payload: {
      trace_id: "trace-1",
      workflow: {
        spec_version: "1.4",
        workflow_id: workflowId,
        name: "Test Workflow",
        icon: "test",
        description: "test",
        version: "1.0",
        nodes,
        edges: [],
        state: {},
      },
      node_id: "node-1",
      inputs: {},
    },
  }) as unknown as StudioClientEvent;

describe("addEnvs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getProjectModelProviders).mockResolvedValue({
      openai: { enabled: true, provider: "openai" } as any,
    });
    vi.mocked(prepareLitellmParams).mockResolvedValue({
      model: "openai/gpt-4o",
    });
    vi.mocked(prisma.project.findUniqueOrThrow).mockResolvedValue({
      apiKey: API_KEY,
    } as any);
  });

  describe("when project has secrets", () => {
    beforeEach(() => {
      vi.mocked(prisma.projectSecret.findMany).mockResolvedValue([
        { name: "OPENAI_API_KEY", encryptedValue: "encrypted:sk-abc123" },
        {
          name: "DATABASE_URL",
          encryptedValue: "encrypted:postgres://localhost",
        },
      ] as any);
    });

    it("includes decrypted secrets in the workflow", async () => {
      const event = makeExecuteComponentEvent();

      const result = await addEnvs(
        event,
        PROJECT_ID,
        testModelProviders,
        testManagedProviders,
      );

      const workflow = (result.payload as any).workflow;
      expect(workflow.secrets).toEqual({
        OPENAI_API_KEY: "sk-abc123",
        DATABASE_URL: "postgres://localhost",
      });
    });

    it("decrypts each secret individually", async () => {
      const event = makeExecuteComponentEvent();

      await addEnvs(event, PROJECT_ID, testModelProviders, testManagedProviders);

      expect(decrypt).toHaveBeenCalledWith("encrypted:sk-abc123");
      expect(decrypt).toHaveBeenCalledWith("encrypted:postgres://localhost");
      expect(decrypt).toHaveBeenCalledTimes(2);
    });
  });

  describe("when project has no secrets", () => {
    beforeEach(() => {
      vi.mocked(prisma.projectSecret.findMany).mockResolvedValue([]);
    });

    it("includes an empty secrets object in the workflow", async () => {
      const event = makeExecuteComponentEvent();

      const result = await addEnvs(
        event,
        PROJECT_ID,
        testModelProviders,
        testManagedProviders,
      );

      const workflow = (result.payload as any).workflow;
      expect(workflow.secrets).toEqual({});
    });
  });

  describe("when the event has no workflow", () => {
    it("returns the event unchanged", async () => {
      const event = {
        type: "is_alive",
        payload: {},
      } as unknown as StudioClientEvent;

      const result = await addEnvs(
        event,
        PROJECT_ID,
        testModelProviders,
        testManagedProviders,
      );

      expect(result).toBe(event);
      expect(prisma.projectSecret.findMany).not.toHaveBeenCalled();
    });
  });

  describe("when fetching secrets", () => {
    beforeEach(() => {
      vi.mocked(prisma.projectSecret.findMany).mockResolvedValue([]);
    });

    it("queries secrets for the correct project", async () => {
      const event = makeExecuteComponentEvent();

      await addEnvs(event, PROJECT_ID, testModelProviders, testManagedProviders);

      expect(prisma.projectSecret.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        select: { name: true, encryptedValue: true },
      });
    });
  });

  // Nodes own their LLM config (spec_version 1.5): there is no
  // workflow-level default to fall back to at dispatch time. See
  // specs/workflows/workflow-node-owned-llm.feature.
  describe("when LLM configs are node-owned", () => {
    beforeEach(() => {
      vi.mocked(prisma.projectSecret.findMany).mockResolvedValue([]);
    });

    const llmNode = (llmValue: unknown) => ({
      id: "llm_call",
      type: "signature",
      position: { x: 0, y: 0 },
      data: {
        name: "LLM Call",
        parameters: [{ identifier: "llm", type: "llm", value: llmValue }],
      },
    });

    it("enriches a node-owned llm config with litellm params", async () => {
      const event = makeExecuteComponentEvent({
        nodes: [llmNode({ model: "openai/gpt-4o" })],
      });

      const result = await addEnvs(
        event,
        PROJECT_ID,
        testModelProviders,
        testManagedProviders,
      );

      const workflow = (result.payload as any).workflow;
      expect(workflow.nodes[0].data.parameters[0].value).toMatchObject({
        model: "openai/gpt-4o",
        litellm_params: { model: "openai/gpt-4o" },
      });
    });

    it("rejects an llm parameter with no value, naming the node", async () => {
      const event = makeExecuteComponentEvent({
        nodes: [llmNode(undefined)],
      });

      await expect(
        addEnvs(event, PROJECT_ID, testModelProviders, testManagedProviders),
      ).rejects.toThrow(LlmModelNotSetError);
      await expect(
        addEnvs(event, PROJECT_ID, testModelProviders, testManagedProviders),
      ).rejects.toThrow('LLM node "LLM Call" has no model selected');
    });

    it("rejects an llm parameter with an empty model, naming the node", async () => {
      const event = makeExecuteComponentEvent({
        nodes: [llmNode({ model: "" })],
      });

      await expect(
        addEnvs(event, PROJECT_ID, testModelProviders, testManagedProviders),
      ).rejects.toThrow(LlmModelNotSetError);
    });
  });
});
