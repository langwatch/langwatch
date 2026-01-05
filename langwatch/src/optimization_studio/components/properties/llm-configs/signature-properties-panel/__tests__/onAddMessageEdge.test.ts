import { describe, expect, it } from "vitest";
import { computeMessageEdgeUpdate } from "../messageEdgeUtils";

/**
 * Tests for the computeMessageEdgeUpdate logic.
 *
 * BUG: When adding a variable to the system prompt, it was corrupting the user message.
 *
 * The key insight is that the form's messages array includes the system message at index 0,
 * but the node's "messages" parameter does NOT include the system message
 * (it's stored separately in the "instructions" parameter).
 *
 * So when we receive idx=0 from the form (system message), we need to update "instructions"
 * not "messages[0]" (which would be the first user message).
 */

describe("computeMessageEdgeUpdate", () => {
  // Form messages include system at index 0
  const formMessages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ];

  // Node data: system message is in "instructions", non-system in "messages"
  const nodeParameters = [
    { identifier: "instructions", type: "str", value: "You are a helpful assistant." },
    {
      identifier: "messages",
      type: "chat_messages",
      value: [{ role: "user", content: "Hello!" }],
    },
  ];

  describe("adding variable to system prompt", () => {
    it("updates instructions parameter, NOT the user message", () => {
      // User adds {{name}} variable to system prompt
      // Form index 0 = system message
      const idx = 0;
      const newPrompt = "You are a helpful assistant.{{name}}";

      const result = computeMessageEdgeUpdate({
        formMessages,
        nodeParameters,
        formIndex: idx,
        newContent: newPrompt,
      });

      // Should update instructions
      expect(result.parameterToUpdate).toBe("instructions");
      expect(result.newValue).toBe("You are a helpful assistant.{{name}}");
    });
  });

  describe("adding variable to user message", () => {
    it("updates messages parameter at correct index", () => {
      // Form index 1 = user message (first non-system)
      const idx = 1;
      const newPrompt = "Hello! {{question}}";

      const result = computeMessageEdgeUpdate({
        formMessages,
        nodeParameters,
        formIndex: idx,
        newContent: newPrompt,
      });

      // Should update messages[0] (adjusted index)
      expect(result.parameterToUpdate).toBe("messages");
      expect(result.messagesIndex).toBe(0);
      expect(result.newValue).toEqual([{ role: "user", content: "Hello! {{question}}" }]);
    });
  });

  describe("multiple messages", () => {
    it("correctly maps form index to messages index when system message exists", () => {
      const formMessagesMultiple = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "First user" },
        { role: "assistant", content: "First assistant" },
        { role: "user", content: "Second user" },
      ];

      const nodeParametersMultiple = [
        { identifier: "instructions", type: "str", value: "System prompt" },
        {
          identifier: "messages",
          type: "chat_messages",
          value: [
            { role: "user", content: "First user" },
            { role: "assistant", content: "First assistant" },
            { role: "user", content: "Second user" },
          ],
        },
      ];

      // Edit second user message (form idx=3, should map to messages idx=2)
      const result = computeMessageEdgeUpdate({
        formMessages: formMessagesMultiple,
        nodeParameters: nodeParametersMultiple,
        formIndex: 3,
        newContent: "Second user {{var}}",
      });

      expect(result.parameterToUpdate).toBe("messages");
      expect(result.messagesIndex).toBe(2);

      const newMessages = result.newValue as Array<{ role: string; content: string }>;
      expect(newMessages[0]?.content).toBe("First user");
      expect(newMessages[1]?.content).toBe("First assistant");
      expect(newMessages[2]?.content).toBe("Second user {{var}}");
    });
  });

  describe("no system message", () => {
    it("uses form index directly when no system message exists", () => {
      const formMessagesNoSystem = [
        { role: "user", content: "Hello!" },
        { role: "assistant", content: "Hi there!" },
      ];

      const nodeParametersNoSystem = [
        { identifier: "instructions", type: "str", value: "" },
        {
          identifier: "messages",
          type: "chat_messages",
          value: [
            { role: "user", content: "Hello!" },
            { role: "assistant", content: "Hi there!" },
          ],
        },
      ];

      // Edit user message at idx=0 (no system message in form)
      const result = computeMessageEdgeUpdate({
        formMessages: formMessagesNoSystem,
        nodeParameters: nodeParametersNoSystem,
        formIndex: 0,
        newContent: "Hello! {{name}}",
      });

      expect(result.parameterToUpdate).toBe("messages");
      expect(result.messagesIndex).toBe(0);
    });
  });
});

