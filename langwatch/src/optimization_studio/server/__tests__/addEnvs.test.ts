import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioClientEvent } from "../../types/events";

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

vi.mock("../../../server/api/routers/modelProviders", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn(),
}));

import { prisma } from "../../../server/db";
import { decrypt } from "../../../utils/encryption";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../../server/api/routers/modelProviders";
import { addEnvs } from "../addEnvs";

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
        default_llm: { model: "openai/gpt-4o" },
        nodes,
        edges: [],
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
        { name: "DATABASE_URL", encryptedValue: "encrypted:postgres://localhost" },
      ] as any);
    });

    it("includes decrypted secrets in the workflow", async () => {
      const event = makeExecuteComponentEvent();

      const result = await addEnvs(event, PROJECT_ID);

      const workflow = (result.payload as any).workflow;
      expect(workflow.secrets).toEqual({
        OPENAI_API_KEY: "sk-abc123",
        DATABASE_URL: "postgres://localhost",
      });
    });

    it("decrypts each secret individually", async () => {
      const event = makeExecuteComponentEvent();

      await addEnvs(event, PROJECT_ID);

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

      const result = await addEnvs(event, PROJECT_ID);

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

      const result = await addEnvs(event, PROJECT_ID);

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

      await addEnvs(event, PROJECT_ID);

      expect(prisma.projectSecret.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        select: { name: true, encryptedValue: true },
      });
    });
  });
});
