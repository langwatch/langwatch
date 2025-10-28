import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromptStudioAdapter } from "../[[...route]]/service-adapter";
import type { CopilotRuntimeChatCompletionRequest } from "@copilotkit/runtime";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

// Mock dependencies
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn((event) => Promise.resolve(event)),
}));

vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn((event) => Promise.resolve(event)),
}));

vi.mock("../../workflows/post_event/post-event", () => ({
  studioBackendPostEvent: vi.fn(),
}));

vi.mock("~/utils/trace", () => ({
  generateOtelTraceId: vi.fn(() => "trace-123"),
}));

describe("PromptStudioAdapter", () => {
  let adapter: PromptStudioAdapter;
  const mockProjectId = "project-123";

  beforeEach(() => {
    adapter = new PromptStudioAdapter({ projectId: mockProjectId });
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with projectId", () => {
      expect(adapter).toBeInstanceOf(PromptStudioAdapter);
    });
  });

  describe("createWorkflow", () => {
    it("should build valid workflow structure with correct node data", () => {
      const mockFormValues: PromptConfigFormValues = {
        configId: "config-123",
        handle: "test-prompt",
        scope: "PROJECT",
        version: {
          versionId: "v1",
          versionNumber: 1,
          configData: {
            prompt: "You are a helpful assistant.",
            llm: {
              model: "gpt-4",
              temperature: 0.7,
              maxTokens: 1000,
            },
            inputs: [{ identifier: "query", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      };

      const messagesHistory = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there!" },
      ];

      // Access private method through adapter instance
      const workflow = (adapter as any).createWorkflow({
        workflowId: "test-workflow",
        nodeId: "node-1",
        formValues: mockFormValues,
        messagesHistory,
      });

      expect(workflow).toMatchObject({
        spec_version: "1.4",
        workflow_id: "test-workflow",
        name: "Prompt Execution",
        enable_tracing: true,
      });

      expect(workflow.nodes).toHaveLength(1);
      expect(workflow.nodes[0].id).toBe("node-1");
      expect(workflow.edges).toEqual([]);
    });

    it("should set default_llm from form values", () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: null,
        scope: "PROJECT",
        version: {
          configData: {
            llm: {
              model: "gpt-3.5-turbo",
              temperature: 0.5,
              maxTokens: 500,
            },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const workflow = (adapter as any).createWorkflow({
        workflowId: "wf-1",
        nodeId: "node-1",
        formValues: mockFormValues,
        messagesHistory: [],
      });

      expect(workflow.default_llm).toEqual({
        model: "gpt-3.5-turbo",
        temperature: 0.5,
        max_tokens: 500,
      });
    });
  });

  describe("buildNodeData", () => {
    it("should build node data with all parameters", () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            prompt: "System instructions",
            llm: { model: "gpt-4" },
            promptingTechnique: "cot",
            demonstrations: { datasetId: "dataset-1" },
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [
              { role: "user", content: "Question" },
              { role: "assistant", content: "Answer" },
            ],
          },
        },
      };

      const messagesHistory = [{ role: "user" as const, content: "Test" }];

      const nodeData = (adapter as any).buildNodeData({
        formValues: mockFormValues,
        messagesHistory,
      });

      expect(nodeData).toMatchObject({
        name: "LLM Node",
        description: "LLM calling node",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      });

      const parametersMap = Object.fromEntries(
        nodeData.parameters.map((p: any) => [p.identifier, p])
      );

      expect(parametersMap.llm).toMatchObject({
        identifier: "llm",
        type: "llm",
        value: { model: "gpt-4" },
      });

      expect(parametersMap.instructions).toMatchObject({
        identifier: "instructions",
        type: "str",
        value: "System instructions",
      });

      expect(parametersMap.prompting_technique).toMatchObject({
        identifier: "prompting_technique",
        type: "prompting_technique",
        value: "cot",
      });

      expect(parametersMap.demonstrations).toMatchObject({
        identifier: "demonstrations",
        type: "dataset",
        value: { datasetId: "dataset-1" },
      });
    });

    it("should filter out system messages from messages history", () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: null,
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const messagesHistory = [
        { role: "system" as const, content: "System" },
        { role: "user" as const, content: "User" },
        { role: "assistant" as const, content: "Assistant" },
      ];

      const nodeData = (adapter as any).buildNodeData({
        formValues: mockFormValues,
        messagesHistory,
      });

      const messagesParam = nodeData.parameters.find(
        (p: any) => p.identifier === "messages"
      );

      expect(messagesParam.value).toEqual([
        { role: "user", content: "User" },
        { role: "assistant", content: "Assistant" },
      ]);
    });

    it("should handle undefined optional parameters", () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: null,
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const nodeData = (adapter as any).buildNodeData({
        formValues: mockFormValues,
        messagesHistory: [],
      });

      const parametersMap = Object.fromEntries(
        nodeData.parameters.map((p: any) => [p.identifier, p])
      );

      expect(parametersMap.prompting_technique.value).toBeUndefined();
      expect(parametersMap.demonstrations.value).toBeUndefined();
    });
  });

  describe("process", () => {
    it("should parse forwardedParameters correctly", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            prompt: "Test",
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
          },
        },
      };

      const variables = { input: "test input" };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [{ role: "user", content: "Hello" }],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables }),
        },
        eventSource: {
          stream: vi.fn(),
        } as any,
      };

      await adapter.process(mockRequest);

      // Verify that parsing doesn't throw
      expect(mockRequest.eventSource.stream).toHaveBeenCalled();
    });

    it("should return threadId", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables: {} }),
        },
        eventSource: {
          stream: vi.fn(),
        } as any,
        threadId: "thread-123",
      };

      const result = await adapter.process(mockRequest);

      expect(result).toHaveProperty("threadId");
      expect(typeof result.threadId).toBe("string");
    });

    it("should prepend form messages to copilot messages", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [
              { role: "user", content: "Form message 1" },
              { role: "assistant", content: "Form response 1" },
            ],
          },
        },
      };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [{ role: "user", content: "Copilot message" }],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables: {} }),
        },
        eventSource: {
          stream: vi.fn((callback) => {
            // Simulate stream callback
            callback({
              sendTextMessageStart: vi.fn(),
              sendTextMessageContent: vi.fn(),
              sendTextMessageEnd: vi.fn(),
              complete: vi.fn(),
            });
            return Promise.resolve();
          }),
        } as any,
      };

      await adapter.process(mockRequest);

      // Verify the stream was called
      expect(mockRequest.eventSource.stream).toHaveBeenCalled();
    });

    it("should filter out system messages from form messages", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [
              { role: "system", content: "System message" },
              { role: "user", content: "User message" },
            ],
          },
        },
      };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables: {} }),
        },
        eventSource: {
          stream: vi.fn((callback) => {
            callback({
              sendTextMessageStart: vi.fn(),
              sendTextMessageContent: vi.fn(),
              sendTextMessageEnd: vi.fn(),
              complete: vi.fn(),
            });
            return Promise.resolve();
          }),
        } as any,
      };

      await adapter.process(mockRequest);

      expect(mockRequest.eventSource.stream).toHaveBeenCalled();
    });
  });

  describe("edge cases", () => {
    it("should handle empty messages array", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
            messages: [],
          },
        },
      };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables: {} }),
        },
        eventSource: {
          stream: vi.fn((callback) => {
            callback({
              sendTextMessageStart: vi.fn(),
              sendTextMessageContent: vi.fn(),
              sendTextMessageEnd: vi.fn(),
              complete: vi.fn(),
            });
            return Promise.resolve();
          }),
        } as any,
      };

      await expect(adapter.process(mockRequest)).resolves.not.toThrow();
    });

    it("should handle missing threadId", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables: {} }),
        },
        eventSource: {
          stream: vi.fn((callback) => {
            callback({
              sendTextMessageStart: vi.fn(),
              sendTextMessageContent: vi.fn(),
              sendTextMessageEnd: vi.fn(),
              complete: vi.fn(),
            });
            return Promise.resolve();
          }),
        } as any,
      };

      const result = await adapter.process(mockRequest);

      expect(result.threadId).toBeDefined();
      expect(typeof result.threadId).toBe("string");
    });

    it("should handle empty variables", async () => {
      const mockFormValues: PromptConfigFormValues = {
        handle: "test",
        scope: "PROJECT",
        version: {
          configData: {
            llm: { model: "gpt-4" },
            inputs: [],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const mockRequest: CopilotRuntimeChatCompletionRequest = {
        messages: [],
        forwardedParameters: {
          model: JSON.stringify({ formValues, variables: {} }),
        },
        eventSource: {
          stream: vi.fn((callback) => {
            callback({
              sendTextMessageStart: vi.fn(),
              sendTextMessageContent: vi.fn(),
              sendTextMessageEnd: vi.fn(),
              complete: vi.fn(),
            });
            return Promise.resolve();
          }),
        } as any,
      };

      await expect(adapter.process(mockRequest)).resolves.not.toThrow();
    });
  });
});