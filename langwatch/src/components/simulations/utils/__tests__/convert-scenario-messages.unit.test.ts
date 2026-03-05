import { Role } from "@copilotkit/runtime-client-gql";
import { describe, expect, it } from "vitest";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { convertScenarioMessagesToCopilotKit } from "../convert-scenario-messages";

describe("convertScenarioMessagesToCopilotKit", () => {
  describe("text messages", () => {
    it("converts simple user text message", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-1",
          role: "user",
          content: "Hello, how are you?",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        id: "msg-1",
        role: "user",
        content: "Hello, how are you?",
      });
    });

    it("converts simple assistant text message", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-2",
          role: "assistant",
          content: "I'm doing well, thank you!",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        id: "msg-2",
        role: "assistant",
        content: "I'm doing well, thank you!",
      });
    });

    it("skips messages with 'None' content", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-3",
          role: "assistant",
          content: "None",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(0);
    });

    it("skips messages with empty content", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-4",
          role: "assistant",
          content: "",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(0);
    });
  });

  describe("mixed content messages", () => {
    it("converts text + image mixed content", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-5",
          role: "assistant",
          content: JSON.stringify([
            { type: "text", text: "Here's an image:" },
            {
              image: "data:image/webp;base64,UklGRgq1AQBXRUJQVlA4WAoAAAAgAAAA",
            },
          ]),
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        id: "msg-5-content-0",
        role: "assistant",
        content: "Here's an image:",
      });
      expect(result[1]).toMatchObject({
        type: "ImageMessage",
        id: "msg-5-image-1",
        role: "assistant",
        format: "webp",
        bytes: "UklGRgq1AQBXRUJQVlA4WAoAAAAgAAAA",
      });
    });

    it("converts multiple text items in mixed content", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-6",
          role: "user",
          content: JSON.stringify([
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
            { type: "text", text: "Third part" },
          ]),
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        id: "msg-6-content-0",
        content: "First part",
      });
      expect(result[1]).toMatchObject({
        type: "TextMessage",
        id: "msg-6-content-1",
        content: "Second part",
      });
      expect(result[2]).toMatchObject({
        type: "TextMessage",
        id: "msg-6-content-2",
        content: "Third part",
      });
    });

    it("handles different image formats", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-7",
          role: "assistant",
          content: JSON.stringify([
            { image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD" },
            {
              image:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            },
          ]),
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: "ImageMessage",
        format: "jpeg",
      });
      expect(result[1]).toMatchObject({
        type: "ImageMessage",
        format: "png",
      });
    });

    it("skips invalid image data URLs", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-8",
          role: "assistant",
          content: JSON.stringify([
            { type: "text", text: "Valid text" },
            { image: "invalid-image-data" },
            { type: "text", text: "More text" },
          ]),
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        content: "Valid text",
      });
      expect(result[1]).toMatchObject({
        type: "TextMessage",
        content: "More text",
      });
    });
  });

  describe("tool calls", () => {
    it("converts messages with tool calls", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-9",
          role: "assistant",
          content: "I'll search for that information.",
          toolCalls: [
            {
              type: "function",
              id: "call-1",
              function: {
                name: "search_web",
                arguments: '{"query": "weather today"}',
              },
            },
          ],
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: "ActionExecutionMessage",
        id: "msg-9-tool-search_web",
        name: "search_web",
        arguments: { query: "weather today" },
      });
      expect(result[1]).toMatchObject({
        type: "TextMessage",
        id: "msg-9",
        content: "I'll search for that information.",
      });
    });

    it("handles multiple tool calls", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-10",
          role: "assistant",
          content: "Let me check multiple sources.",
          toolCalls: [
            {
              type: "function",
              id: "call-1",
              function: {
                name: "search_web",
                arguments: '{"query": "first search"}',
              },
            },
            {
              type: "function",
              id: "call-2",
              function: {
                name: "get_weather",
                arguments: '{"location": "NYC"}',
              },
            },
          ],
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        type: "ActionExecutionMessage",
        name: "search_web",
      });
      expect(result[1]).toMatchObject({
        type: "ActionExecutionMessage",
        name: "get_weather",
      });
      expect(result[2]).toMatchObject({
        type: "TextMessage",
        content: "Let me check multiple sources.",
      });
    });

    it("handles tool calls with invalid JSON arguments", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-11",
          role: "assistant",
          content: "Testing invalid JSON.",
          toolCalls: [
            {
              type: "function",
              id: "call-1",
              function: {
                name: "test_function",
                arguments: "invalid json",
              },
            },
          ],
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: "ActionExecutionMessage",
        id: "msg-11-tool-test_function",
        name: "test_function",
        arguments: {
          data: "invalid json",
        },
      });
    });
  });

  describe("tool result messages", () => {
    it("converts tool result messages", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-12",
          role: "tool",
          content: '{"result": "Search completed", "data": [1, 2, 3]}',
          toolCallId: "call-1",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "ResultMessage",
        id: "msg-12",
        actionExecutionId: "msg-12",
        actionName: "tool",
        result: { result: "Search completed", data: [1, 2, 3] },
      });
    });

    it("handles tool result with invalid JSON", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-13",
          role: "tool",
          content: "invalid json result",
          toolCallId: "call-1",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "ResultMessage",
        id: "msg-13",
        actionExecutionId: "msg-13",
        actionName: "tool",
        result: {
          data: "invalid json result",
        },
      });
    });
  });

  describe("complex scenarios", () => {
    it("handles multiple messages in correct order", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-14",
          role: "user",
          content: "What's the weather like?",
        },
        {
          id: "msg-15",
          role: "assistant",
          content: "Let me check that for you.",
          toolCalls: [
            {
              type: "function",
              id: "call-1",
              function: {
                name: "get_weather",
                arguments: '{"location": "NYC"}',
              },
            },
          ],
        },
        {
          id: "msg-16",
          role: "tool",
          content: '{"temperature": "72°F", "condition": "sunny"}',
          toolCallId: "call-1",
        },
        {
          id: "msg-17",
          role: "assistant",
          content: "It's sunny and 72°F in NYC!",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        role: "user",
        content: "What's the weather like?",
      });
      expect(result[1]).toMatchObject({
        type: "ActionExecutionMessage",
        name: "get_weather",
      });
      expect(result[2]).toMatchObject({
        type: "TextMessage",
        role: "assistant",
        content: "Let me check that for you.",
      });
      expect(result[3]).toMatchObject({
        type: "ResultMessage",
        id: "msg-16",
        actionExecutionId: "msg-16",
        actionName: "tool",
      });
      expect(result[4]).toMatchObject({
        type: "TextMessage",
        role: "assistant",
        content: "It's sunny and 72°F in NYC!",
      });
    });

    it("handles mixed content with tool calls", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-18",
          role: "assistant",
          content: JSON.stringify([
            { type: "text", text: "Here's what I found:" },
            {
              image:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            },
          ]),
          toolCalls: [
            {
              type: "function",
              id: "call-1",
              function: {
                name: "search_database",
                arguments: '{"query": "user data"}',
              },
            },
          ],
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        type: "ActionExecutionMessage",
        name: "search_database",
      });
      expect(result[1]).toMatchObject({
        type: "TextMessage",
        content: "Here's what I found:",
      });
      expect(result[2]).toMatchObject({
        type: "ImageMessage",
        format: "png",
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty messages array", () => {
      const result = convertScenarioMessagesToCopilotKit([]);
      expect(result).toHaveLength(0);
    });

    it("handles unknown message roles", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-19",
          role: "unknown" as any,
          content: "This should be ignored",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);
      expect(result).toHaveLength(0);
    });

    it("handles malformed JSON content", () => {
      const messages: ScenarioMessageSnapshotEvent["messages"] = [
        {
          id: "msg-20",
          role: "assistant",
          content: "malformed json content",
        },
      ];

      const result = convertScenarioMessagesToCopilotKit(messages);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "TextMessage",
        content: "malformed json content",
      });
    });
  });
});
