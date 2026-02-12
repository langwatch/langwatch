/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeAgentData } from "../../types";
import { SerializedCodeAgentAdapter } from "../code-agent.adapter";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SerializedCodeAgentAdapter", () => {
  const defaultConfig: CodeAgentData = {
    type: "code",
    agentId: "agent_123",
    code: 'def execute(input):\n    return f"processed: {input}"',
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  };

  const nlpServiceUrl = "http://localhost:8080";

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "Hello" }],
    newMessages: [{ role: "user", content: "Hello" }],
    requestedRole: AgentRole.AGENT,
    judgmentRequest: false,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ outputs: { output: "processed: Hello" } }),
      text: vi.fn().mockResolvedValue(""),
    });
  });

  it("has AGENT role", () => {
    const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);
    expect(adapter.name).toBe("SerializedCodeAgentAdapter");
  });

  describe("when the adapter receives a message from the simulator", () => {
    it("passes the message as input to the code execution", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);

      await adapter.call(defaultInput);

      expect(mockFetch).toHaveBeenCalledWith(
        `${nlpServiceUrl}/execute_sync`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(callBody.type).toBe("execute_component");
      expect(callBody.payload.node_id).toBe("code_agent");

      // Verify the code is passed in the workflow
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode).toBeDefined();
      expect(codeNode.data.parameters[0].value).toBe(defaultConfig.code);
    });

    it("returns the code output as a response string", async () => {
      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);

      const result = await adapter.call(defaultInput);

      expect(result).toBe("processed: Hello");
    });
  });

  describe("when the code execution fails", () => {
    it("throws an error with a descriptive message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("Internal Server Error"),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);

      await expect(adapter.call(defaultInput)).rejects.toThrow(
        "Code execution failed: HTTP 500 - Internal Server Error",
      );
    });
  });

  describe("when agent has no explicit inputs/outputs", () => {
    it("uses default input/output identifiers", async () => {
      const configNoIO: CodeAgentData = {
        ...defaultConfig,
        inputs: [],
        outputs: [],
      };

      const adapter = new SerializedCodeAgentAdapter(configNoIO, nlpServiceUrl);

      await adapter.call(defaultInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.inputs[0].identifier).toBe("input");
      expect(codeNode.data.outputs[0].identifier).toBe("output");
    });
  });

  describe("when the NLP service returns nested output", () => {
    it("extracts the first output by identifier", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          outputs: { output: "nested result" },
        }),
        text: vi.fn().mockResolvedValue(""),
      });

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);
      const result = await adapter.call(defaultInput);

      expect(result).toBe("nested result");
    });
  });

  describe("when the adapter uses last user message", () => {
    it("extracts content from the last user message in the conversation", async () => {
      const multiMessageInput: AgentInput = {
        ...defaultInput,
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second message" },
        ],
      };

      const adapter = new SerializedCodeAgentAdapter(defaultConfig, nlpServiceUrl);
      await adapter.call(multiMessageInput);

      const callBody = JSON.parse(mockFetch.mock.calls[0]![1].body);
      const codeNode = callBody.payload.workflow.nodes.find(
        (n: { id: string }) => n.id === "code_agent",
      );
      expect(codeNode.data.inputs[0].value).toBe("Second message");
    });
  });
});
