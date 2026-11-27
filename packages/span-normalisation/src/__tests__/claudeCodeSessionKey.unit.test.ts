/**
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";

import {
  canonicaliseLogRecord,
  canonicaliseSpanAttributes,
  orderedSpanCanonicalisers,
} from "../spanCanonicalisation.ts";

const codexScopes = { isCodexScope: () => false, execScope: "codex_exec" };

function canonicalise(
  spanAttributes: Record<string, unknown>,
  resourceAttributes: Record<string, unknown> = {},
) {
  return canonicaliseSpanAttributes({
    canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
    spanAttributes,
    events: [],
    span: {
      name: "claude_code.interaction",
      kind: null,
      instrumentationScope: { name: "com.anthropic.claude_code.tracing" },
      statusMessage: null,
      statusCode: null,
      parentSpanId: null,
      resourceAttributes,
    },
  }).attributes;
}

describe("a Claude Code span's conversation", () => {
  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("is Claude Code's session id when nothing else is declared", () => {
    const attributes = canonicalise({ "session.id": "cc-run-1" });

    expect(attributes["gen_ai.conversation.id"]).toBe("cc-run-1");
  });

  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("is Claude Code's session id over a launcher's thread, which stays filterable", () => {
    const attributes = canonicalise({
      "session.id": "cc-run-1",
      "langwatch.thread.id": "channel_support",
    });

    expect(attributes["gen_ai.conversation.id"]).toBe("cc-run-1");
    expect(attributes["langwatch.thread.id"]).toBe("channel_support");
  });

  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("keeps a launcher's thread that names the same session as the conversation", () => {
    const attributes = canonicalise({
      "session.id": "cc-run-1",
      "langwatch.thread.id": "cc-run-1",
    });

    expect(attributes["gen_ai.conversation.id"]).toBe("cc-run-1");
    expect(attributes).not.toHaveProperty("langwatch.thread.id");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("is the launcher's declared session over Claude Code's own", () => {
    const attributes = canonicalise({
      "session.id": "cc-run-2",
      "langwatch.session.id": "agent_scout",
      "langwatch.thread.id": "channel_support",
    });

    expect(attributes["gen_ai.conversation.id"]).toBe("agent_scout");
    expect(attributes["langwatch.thread.id"]).toBe("channel_support");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("is a session declared on the resource, as the session aggregate reads it", () => {
    const attributes = canonicalise(
      { "session.id": "cc-run-3", "langwatch.thread.id": "channel_support" },
      { "langwatch.session.id": "agent_scout" },
    );

    expect(attributes["gen_ai.conversation.id"]).toBe("agent_scout");
    expect(attributes).not.toHaveProperty("resourceAttributes");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("reads a numeric declared session the way the session aggregate does", () => {
    const attributes = canonicalise({ "session.id": "cc-run-4" }, { "langwatch.session.id": 42 });

    expect(attributes["gen_ai.conversation.id"]).toBe("42");
  });

  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("keeps a conversation the span itself carried as the thread", () => {
    const attributes = canonicalise({
      "session.id": "cc-run-1",
      "gen_ai.conversation.id": "conversation_acme",
    });

    expect(attributes["gen_ai.conversation.id"]).toBe("cc-run-1");
    expect(attributes["langwatch.thread.id"]).toBe("conversation_acme");
  });
});

describe("a Claude Code prompt record's thread", () => {
  /** @scenario a launcher's declared session groups every harness session it runs */
  it("is a session declared on the record's resource", () => {
    const { attributes } = canonicaliseLogRecord({
      canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
      scopeName: "com.anthropic.claude_code.events",
      body: "claude_code.user_prompt",
      attributes: { "event.name": "user_prompt", prompt: "hi", "session.id": "cc-run-5" },
      resourceAttributes: { "langwatch.session.id": "agent_scout" },
    });

    expect(attributes["langwatch.thread.id"]).toBe("agent_scout");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("is the declared session over a conversation the record named itself", () => {
    const { attributes } = canonicaliseLogRecord({
      canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
      scopeName: "com.anthropic.claude_code.events",
      body: "claude_code.user_prompt",
      attributes: {
        "event.name": "user_prompt",
        prompt: "hi",
        "session.id": "cc-run-6",
        "gen_ai.conversation.id": "conversation_acme",
        "langwatch.session.id": "agent_scout",
      },
    });

    expect(attributes["langwatch.thread.id"]).toBe("agent_scout");
  });
});
