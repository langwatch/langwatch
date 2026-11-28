/**
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";

import { buildCodingAgentTranscript } from "../coding-agent-transcript.ts";

function prompt(attributes: Record<string, unknown>) {
  return {
    timestampMs: 1_000,
    attributes: {
      "event.name": "claude_code.user_prompt",
      prompt: "summarise notes",
      ...attributes,
    },
  };
}

describe("a transcript's session id", () => {
  /** @scenario a launcher's declared session groups every harness session it runs */
  it("is the launcher's declared session over the run's own session", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [prompt({ "session.id": "cc-run-1", "langwatch.session.id": "agent_scout" })],
    });

    expect(transcript.sessionId).toBe("agent_scout");
  });

  /** @scenario a launcher's declared session groups every harness session it runs */
  it("is a session declared only on the record's resource", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [
        {
          ...prompt({ "session.id": "cc-run-1" }),
          resourceAttributes: { "langwatch.session.id": "agent_scout" },
        },
      ],
    });

    expect(transcript.sessionId).toBe("agent_scout");
  });

  /** @scenario a session with no declared session is keyed by the agent's own session id */
  it("is the run's own session when nothing is declared", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [],
      logs: [prompt({ "session.id": "cc-run-1" })],
    });

    expect(transcript.sessionId).toBe("cc-run-1");
  });
});
