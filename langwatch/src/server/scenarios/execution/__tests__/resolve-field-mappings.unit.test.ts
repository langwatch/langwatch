/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import {
  computeBestMatchMappings,
  resolveFieldMappings,
} from "../resolve-field-mappings";
import type { FieldMapping } from "../types";

const makeAgentInput = (
  overrides: Partial<AgentInput> = {},
): AgentInput => ({
  threadId: "thread-1",
  messages: [{ role: "user", content: "Hello world" }],
  newMessages: [{ role: "user", content: "Hello world" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
  ...overrides,
});

describe("resolveFieldMappings", () => {
  describe("when mapping type is source with path input", () => {
    it("resolves query to the last user message content", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const agentInput = makeAgentInput();

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["query"]).toBe("Hello world");
    });

    it("picks the last user message when there are multiple messages", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const agentInput = makeAgentInput({
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second message" },
        ],
      });

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["query"]).toBe("Second message");
    });

    it("returns empty string when there are no user messages", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
      };
      const agentInput = makeAgentInput({ messages: [] });

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["query"]).toBe("");
    });
  });

  describe("when mapping type is source with path messages", () => {
    it("resolves history to a JSON string of the messages array", () => {
      const messages = [
        { role: "user" as const, content: "Hello" },
        { role: "assistant" as const, content: "Hi there" },
      ];
      const fieldMappings: Record<string, FieldMapping> = {
        history: { type: "source", sourceId: "scenario", path: ["messages"] },
      };
      const agentInput = makeAgentInput({ messages });

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["history"]).toBe(JSON.stringify(messages));
    });
  });

  describe("when mapping type is source with path threadId", () => {
    it("resolves tid to the thread ID", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        tid: { type: "source", sourceId: "scenario", path: ["threadId"] },
      };
      const agentInput = makeAgentInput({ threadId: "abc-123" });

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["tid"]).toBe("abc-123");
    });

    it("returns empty string when threadId is absent", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        tid: { type: "source", sourceId: "scenario", path: ["threadId"] },
      };
      const agentInput = makeAgentInput({ threadId: undefined });

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["tid"]).toBe("");
    });
  });

  describe("when mapping type is value", () => {
    it("resolves context to the literal value string", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        context: { type: "value", value: "Use the knowledge base" },
      };
      const agentInput = makeAgentInput();

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["context"]).toBe("Use the knowledge base");
    });
  });

  describe("when mapping has an unrecognized sourceId", () => {
    it("returns empty string", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        query: { type: "source", sourceId: "unknown_source", path: ["input"] },
      };
      const agentInput = makeAgentInput();

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["query"]).toBe("");
    });
  });

  describe("when mapping type is source with an unknown path", () => {
    it("returns empty string for an unrecognized source path", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        query: { type: "source", sourceId: "scenario", path: ["unknown_field"] },
      };
      const agentInput = makeAgentInput();

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["query"]).toBe("");
    });
  });

  describe("when multiple mappings are provided", () => {
    it("resolves all mappings", () => {
      const fieldMappings: Record<string, FieldMapping> = {
        query: { type: "source", sourceId: "scenario", path: ["input"] },
        context: { type: "value", value: "KB context" },
      };
      const agentInput = makeAgentInput();

      const result = resolveFieldMappings({ fieldMappings, agentInput });

      expect(result["query"]).toBe("Hello world");
      expect(result["context"]).toBe("KB context");
    });
  });
});

describe("computeBestMatchMappings", () => {
  describe("when agent has a single input named 'input'", () => {
    it("maps it to input (alias match)", () => {
      const result = computeBestMatchMappings({
        inputs: [{ identifier: "input" }],
      });

      expect(result).toEqual({
        input: { type: "source", sourceId: "scenario", path: ["input"] },
      });
    });
  });

  describe("when agent has a single input with no alias match", () => {
    it("defaults to input", () => {
      const result = computeBestMatchMappings({
        inputs: [{ identifier: "foo" }],
      });

      expect(result).toEqual({
        foo: { type: "source", sourceId: "scenario", path: ["input"] },
      });
    });
  });

  describe("when agent has inputs matching known aliases", () => {
    it("maps query to input and history to messages", () => {
      const result = computeBestMatchMappings({
        inputs: [{ identifier: "query" }, { identifier: "history" }],
      });

      expect(result).toEqual({
        query: { type: "source", sourceId: "scenario", path: ["input"] },
        history: { type: "source", sourceId: "scenario", path: ["messages"] },
      });
    });
  });

  describe("when agent has inputs with no alias match and multiple inputs", () => {
    it("leaves unmatched inputs unmapped", () => {
      const result = computeBestMatchMappings({
        inputs: [{ identifier: "query" }, { identifier: "custom_field" }],
      });

      expect(result).toEqual({
        query: { type: "source", sourceId: "scenario", path: ["input"] },
      });
      expect(result["custom_field"]).toBeUndefined();
    });
  });

  describe("when agent has no inputs", () => {
    it("returns empty record", () => {
      const result = computeBestMatchMappings({ inputs: [] });

      expect(result).toEqual({});
    });
  });

  describe("when agent has thread_id alias", () => {
    it("maps session_id to threadId", () => {
      const result = computeBestMatchMappings({
        inputs: [{ identifier: "message" }, { identifier: "session_id" }],
      });

      expect(result).toEqual({
        message: { type: "source", sourceId: "scenario", path: ["input"] },
        session_id: { type: "source", sourceId: "scenario", path: ["threadId"] },
      });
    });
  });
});
