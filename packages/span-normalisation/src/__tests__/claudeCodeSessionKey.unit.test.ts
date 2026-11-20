/**
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";

import { canonicaliseSpanAttributes, orderedSpanCanonicalisers } from "../spanCanonicalisation.ts";

const codexScopes = { isCodexScope: () => false, execScope: "codex_exec" };

function canonicalise(spanAttributes: Record<string, unknown>) {
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
});
