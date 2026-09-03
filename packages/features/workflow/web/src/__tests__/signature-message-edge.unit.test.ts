import { describe, expect, it } from "vitest";
import { computeMessageEdgeUpdate } from "../model/signature-message-edge";

describe("computeMessageEdgeUpdate", () => {
  const formMessages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ];

  const nodeParameters = [
    {
      identifier: "instructions",
      type: "str",
      value: "You are a helpful assistant.",
    },
    {
      identifier: "messages",
      type: "chat_messages",
      value: [{ role: "user", content: "Hello!" }],
    },
  ];

  it("maps the system form message to DSL instructions", () => {
    const result = computeMessageEdgeUpdate({
      formMessages,
      nodeParameters,
      formIndex: 0,
      newContent: "You are a helpful assistant.{{name}}",
    });

    expect(result.parameterToUpdate).toBe("instructions");
    expect(result.newValue).toBe("You are a helpful assistant.{{name}}");
  });

  it("offsets a user message by the form's system message", () => {
    const result = computeMessageEdgeUpdate({
      formMessages,
      nodeParameters,
      formIndex: 1,
      newContent: "Hello! {{question}}",
    });

    expect(result.parameterToUpdate).toBe("messages");
    expect(result.messagesIndex).toBe(0);
    expect(result.newValue).toEqual([{ role: "user", content: "Hello! {{question}}" }]);
  });

  it("updates the matching DSL message in a longer conversation", () => {
    const result = computeMessageEdgeUpdate({
      formMessages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "First user" },
        { role: "assistant", content: "First assistant" },
        { role: "user", content: "Second user" },
      ],
      nodeParameters: [
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
      ],
      formIndex: 3,
      newContent: "Second user {{var}}",
    });

    expect(result.messagesIndex).toBe(2);
    expect(result.newValue).toEqual([
      { role: "user", content: "First user" },
      { role: "assistant", content: "First assistant" },
      { role: "user", content: "Second user {{var}}" },
    ]);
  });

  it("uses the form index when there is no system message", () => {
    const result = computeMessageEdgeUpdate({
      formMessages: [
        { role: "user", content: "Hello!" },
        { role: "assistant", content: "Hi there!" },
      ],
      nodeParameters: [
        { identifier: "instructions", type: "str", value: "" },
        {
          identifier: "messages",
          type: "chat_messages",
          value: [
            { role: "user", content: "Hello!" },
            { role: "assistant", content: "Hi there!" },
          ],
        },
      ],
      formIndex: 0,
      newContent: "Hello! {{name}}",
    });

    expect(result.parameterToUpdate).toBe("messages");
    expect(result.messagesIndex).toBe(0);
  });
});
