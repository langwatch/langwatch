import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../src";

describe("TraceCanonicalisationService", () => {
  const service = TraceCanonicalisationService.create();
  const span = {
    name: "test",
    kind: 0,
    instrumentationScope: { name: "test", version: null },
    statusMessage: null,
    statusCode: null,
    parentSpanId: null,
  };

  it("repairs a pii token escaped inside metadata json", () => {
    const result = service.canonicalizeSpanAttributes({
      spanAttributes: {
        metadata: String.raw`{"redacted":"\<US_DRIVER_LICENSE>"}`,
      },
      events: [],
      span,
    });

    expect(result.attributes["metadata.redacted"]).toBe("<US_DRIVER_LICENSE>");
    expect(result.attributes["metadata._raw"]).toBeUndefined();
  });

  it("lifts the Claude session thread even when a legacy thread is already present", () => {
    const result = service.canonicalizeLogRecord({
      scopeName: "com.anthropic.claude_code.events",
      body: "",
      attributes: {
        "event.name": "user_prompt",
        prompt: "Summarise the trace session",
        "session.id": "session-2026-08-26",
        "langwatch.thread.id": "legacy-thread-42",
      },
    });

    expect(result.attributes).toEqual({
      "langwatch.input": "Summarise the trace session",
      "langwatch.thread.id": "session-2026-08-26",
    });
    expect(result.appliedRules).toContain("claude-code/user_prompt");
  });

  it("promotes camel-case metadata fields, labels, and nested values", () => {
    const result = service.canonicalizeSpanAttributes({
      spanAttributes: {
        metadata: JSON.stringify({
          userId: "user-1",
          threadId: "thread-1",
          customerId: "customer-1",
          labels: ["production"],
          nested: { source: "sdk" },
        }),
      },
      events: [],
      span,
    });

    expect(result.attributes).toMatchObject({
      "langwatch.user.id": "user-1",
      "gen_ai.conversation.id": "thread-1",
      "langwatch.customer.id": "customer-1",
      "langwatch.labels": ["production"],
      "metadata.nested": JSON.stringify({ source: "sdk" }),
    });
  });

  it("accepts the langwatch metadata alias", () => {
    const result = service.canonicalizeSpanAttributes({
      spanAttributes: {
        "langwatch.metadata": JSON.stringify({
          user_id: "user-1",
          thread_id: "thread-1",
          customer_id: "customer-1",
          labels: ["beta"],
        }),
      },
      events: [],
      span,
    });

    expect(result.attributes).toMatchObject({
      "langwatch.user.id": "user-1",
      "gen_ai.conversation.id": "thread-1",
      "langwatch.customer.id": "customer-1",
      "langwatch.labels": ["beta"],
    });
  });

  it("keeps explicit canonical metadata over embedded values", () => {
    const result = service.canonicalizeSpanAttributes({
      spanAttributes: {
        "langwatch.user.id": "explicit-user",
        "langwatch.thread.id": "explicit-thread",
        "langwatch.customer.id": "explicit-customer",
        "langwatch.labels": ["explicit"],
        metadata: JSON.stringify({
          user_id: "embedded-user",
          thread_id: "embedded-thread",
          customer_id: "embedded-customer",
          labels: ["embedded"],
        }),
      },
      events: [],
      span,
    });

    expect(result.attributes).toMatchObject({
      "langwatch.user.id": "explicit-user",
      "gen_ai.conversation.id": "explicit-thread",
      "langwatch.customer.id": "explicit-customer",
      "langwatch.labels": ["explicit"],
    });
  });

  it("prefers metadata over its legacy alias", () => {
    const result = service.canonicalizeSpanAttributes({
      spanAttributes: {
        metadata: JSON.stringify({ user_id: "current" }),
        "langwatch.metadata": JSON.stringify({ user_id: "legacy" }),
      },
      events: [],
      span,
    });

    expect(result.attributes["langwatch.user.id"]).toBe("current");
  });

  it("preserves malformed metadata as the raw value", () => {
    const invalidObject = service.canonicalizeSpanAttributes({
      spanAttributes: { metadata: "not valid json {{{" },
      events: [],
      span,
    });
    const array = service.canonicalizeSpanAttributes({
      spanAttributes: { metadata: JSON.stringify([1, 2, 3]) },
      events: [],
      span,
    });

    expect(invalidObject.attributes["metadata._raw"]).toBe("not valid json {{{");
    expect(array.attributes["metadata._raw"]).toBe(JSON.stringify([1, 2, 3]));
  });

  it("ignores malformed, incomplete, and zero-cost metrics", () => {
    for (const metrics of [
      "{not valid json",
      JSON.stringify({ promptTokens: 100 }),
      JSON.stringify({
        type: "json",
        value: { promptTokens: 0, completionTokens: 0, cost: 0 },
      }),
    ]) {
      const result = service.canonicalizeSpanAttributes({
        spanAttributes: { "langwatch.metrics": metrics },
        events: [],
        span,
      });

      expect(result.attributes["langwatch.span.cost"]).toBeUndefined();
    }
  });

  it("derives input text from the last user message", () => {
    const result = service.tryExtractMessageText({
      value: [
        { role: "system", content: "instructions" },
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: [{ type: "text", text: "last question" }] },
      ],
      mode: "input",
    });

    expect(result).toBe("last question");
  });

  it("derives Claude request messages and tool results together", () => {
    const result = service.deriveClaudeRequestContent({
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: "command output",
              },
            ],
          },
        ],
      }),
    });

    expect(result.messages).toEqual([{ role: "user", content: "command output" }]);
    expect(result.toolResults).toEqual([{ useId: "tool-1", text: "command output" }]);
  });

  it("derives Claude response content and call classification", () => {
    const body = JSON.stringify({
      content: [{ type: "text", text: '{"title":"A useful title"}' }],
    });

    expect(service.deriveClaudeResponseContent({ body })).toEqual({
      assistantText: '{"title":"A useful title"}',
      assistantOutput: '{"title":"A useful title"}',
      sessionTitle: "A useful title",
    });
    expect(
      service.classifyClaudeCall({
        querySource: "repl_main_thread",
        llmRequestContext: "interaction",
      }),
    ).toEqual({ conversational: true, cacheWritesLongLived: true });
  });
});
