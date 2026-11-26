import { describe, expect, it } from "vitest";

import {
  fromOpenAIMessages,
  toOpenAIMessages,
  type ScenarioMessage,
} from "../recipes/owasp-red-team/templates/typescript/agent-adapter.ts";

// Backs specs/skills/owasp-red-team.feature: the TypeScript adapter keeps
// tool calls intact between scenario messages and OpenAI chat messages.

describe("OWASP red team pack adapter", () => {
  /** @scenario "The TypeScript adapter converts scenario messages to OpenAI chat messages and back" */
  it("round trips a tool call through the OpenAI message helpers", () => {
    const conversation: ScenarioMessage[] = [
      { role: "system", content: "ignored" },
      { role: "user", content: "Where is order 42?" },
    ];
    expect(toOpenAIMessages({ messages: conversation })).toEqual([
      { role: "user", content: "Where is order 42?" },
    ]);
    const agentTurn = fromOpenAIMessages({
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "lookup_order", arguments: '{"id":42}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: '{"status":"shipped"}' },
        { role: "assistant", content: "It shipped." },
      ],
    });
    expect(agentTurn[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "lookup_order",
          output: { type: "json", value: { status: "shipped" } },
        },
      ],
    });
    expect(toOpenAIMessages({ messages: agentTurn })).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "lookup_order", arguments: '{"id":42}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"status":"shipped"}' },
      { role: "assistant", content: "It shipped." },
    ]);

    const refusal = fromOpenAIMessages({
      messages: [{ role: "assistant", content: null, refusal: "I can't share that." }],
    });
    expect(refusal).toEqual([
      { role: "assistant", content: [{ type: "text", text: "I can't share that." }] },
    ]);

    const malformed = fromOpenAIMessages({
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c2",
              type: "function",
              function: { name: "refund", arguments: '{"amount":1000' },
            },
          ],
        },
      ],
    });
    expect(toOpenAIMessages({ messages: malformed })[0]).toMatchObject({
      tool_calls: [{ function: { name: "refund", arguments: '{"amount":1000' } }],
    });

    const jsonString = fromOpenAIMessages({
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "c3", type: "function", function: { name: "search", arguments: '"abc"' } },
          ],
        },
      ],
    });
    expect(toOpenAIMessages({ messages: jsonString })[0]).toMatchObject({
      tool_calls: [{ function: { name: "search", arguments: '"abc"' } }],
    });

    const emptyArguments = fromOpenAIMessages({
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "c4", type: "function", function: { name: "ping", arguments: "" } }],
        },
      ],
    });
    expect(toOpenAIMessages({ messages: emptyArguments })[0]).toMatchObject({
      tool_calls: [{ function: { name: "ping", arguments: "" } }],
    });
  });
});
