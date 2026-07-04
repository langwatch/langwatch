import { describe, expect, it } from "vitest";
import { classifyBlocks } from "../blockClassifier.service";
import {
  parseClaudeCodeRequestBody,
  parseClaudeCodeResponseBody,
} from "../claudeCodeBody";

describe("parseClaudeCodeRequestBody", () => {
  it("parses system + messages with content structure and tools preserved", () => {
    const body = JSON.stringify({
      model: "claude-fable-5",
      system: [
        {
          type: "text",
          text: "You are helpful",
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [{ name: "Bash" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
      ],
    });

    const result = parseClaudeCodeRequestBody(body);

    expect(result?.messages).toHaveLength(3);
    expect(result?.messages[0]?.role).toBe("system");
    // content-block structure (incl. cache_control) is kept, not flattened.
    expect(result?.messages[0]?.content).toEqual([
      {
        type: "text",
        text: "You are helpful",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(result?.tools).toEqual([{ name: "Bash" }]);
    // A clean parse kept every turn, including the newest.
    expect(result?.newestTurnComplete).toBe(true);
  });

  it("preserves cache_control so classifyBlocks finds a REAL breakpoint (no inference needed)", () => {
    const body = JSON.stringify({
      system: [
        { type: "text", text: "sys", cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: "prior turn" },
        { role: "user", content: "the fresh turn" },
      ],
    });
    const parsed = parseClaudeCodeRequestBody(body)!;

    const { lastInputCacheBreakpointIndex } = classifyBlocks({
      inputMessages: parsed.messages,
    });

    expect(lastInputCacheBreakpointIndex).not.toBeNull();
  });

  it("recovers system + complete leading messages from a truncated body, structure intact", () => {
    const full = JSON.stringify({
      system: [{ type: "text", text: "sys prompt" }],
      messages: [
        { role: "user", content: [{ type: "text", text: "first" }] },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
        {
          role: "user",
          content: [{ type: "text", text: "cut off here, a long tail" }],
        },
      ],
    });
    const truncated = full.slice(0, full.indexOf("cut off"));

    const result = parseClaudeCodeRequestBody(truncated)!;

    // system + first two turns recovered; the truncated third turn is dropped.
    expect(result.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    // content kept as a block array, not flattened to a string.
    expect(Array.isArray(result.messages[1]?.content)).toBe(true);
    // truncation dropped the tail, so the newest turn is flagged incomplete —
    // the caller reinstates the current prompt from the clean side-channel.
    expect(result.newestTurnComplete).toBe(false);
  });

  it("returns null for an absent or empty body", () => {
    expect(parseClaudeCodeRequestBody(undefined)).toBeNull();
    expect(parseClaudeCodeRequestBody("")).toBeNull();
  });
});

describe("parseClaudeCodeResponseBody", () => {
  it("wraps the response content blocks as one assistant message", () => {
    const body = JSON.stringify({
      content: [
        { type: "thinking", thinking: "..." },
        { type: "text", text: "the answer" },
        { type: "tool_use", name: "Bash", input: {} },
      ],
    });

    const result = parseClaudeCodeResponseBody(body);

    expect(result).toHaveLength(1);
    expect(result?.[0]?.role).toBe("assistant");
    expect(Array.isArray(result?.[0]?.content)).toBe(true);
  });

  it("returns null for a truncated response body so the caller uses the flat reply", () => {
    expect(
      parseClaudeCodeResponseBody('{"content":[{"type":"text","text":"cut'),
    ).toBeNull();
  });
});
