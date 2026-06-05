import { describe, expect, it } from "vitest";

import {
  ClaudeCodeExtractor,
  extractAssistantTextFromResponseBody,
  extractUserTextFromRequestBody,
  isConversationalQuerySource,
} from "../claudeCode";
import { createLogExtractorContext } from "./_testHelpers";

const SCOPE = "com.anthropic.claude_code.events";

describe("ClaudeCodeExtractor.applyLog", () => {
  // The model-call events (api_request / api_request_body / api_response_body)
  // are trapped at ingest and converted to a gen_ai span by
  // claude-code-log-to-span.ts — they never reach this log extractor. The only
  // claude_code event the log side lifts is user_prompt.

  it("lifts the user-typed prompt onto langwatch.input from a user_prompt event", () => {
    // claude-code 2.x only emits the `prompt` attribute when
    // OTEL_LOG_USER_PROMPTS=1 is in the env. The langwatch wrapper
    // sets that by default for claude, so this is the standard path.
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "user_prompt",
      prompt: "Reply EXACTLY this token and nothing else: PONG-X",
      "session.id": "sess_user_prompt",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.input": "Reply EXACTLY this token and nothing else: PONG-X",
      "langwatch.thread.id": "sess_user_prompt",
    });
    expect(ctx.recordRule).toHaveBeenCalledWith("claude-code/user_prompt");
  });

  it("does NOT overwrite a thread.id already set by an earlier event", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "user_prompt",
      prompt: "hi",
      "session.id": "sess_new",
    });
    ctx.out["langwatch.thread.id"] = "sess_earlier";

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out["langwatch.thread.id"]).toBe("sess_earlier");
    expect(ctx.out["langwatch.input"]).toBe("hi");
  });

  it("returns no-op for a non-claude_code scope", () => {
    const ctx = createLogExtractorContext("com.openai.codex.events", {
      "event.name": "user_prompt",
      prompt: "ignored",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("does NOT lift the converted model-call events on the log path", () => {
    // api_request is trapped + converted to a span upstream; if one ever
    // reached this extractor it must NOT re-lift cost/tokens onto the fold
    // (that would double-count). The extractor ignores it.
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "api_request",
      model: "claude-opus-4-7",
      cost_usd: "0.0875",
      input_tokens: "120",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("returns no-op for an unknown event in claude_code scope", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "tool_decision",
      tool_name: "Bash",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("span-side apply is a no-op (Path A flows through GenAIExtractor)", () => {
    const extractor = new ClaudeCodeExtractor();
    expect(extractor.id).toBe("claude-code");
    expect(typeof extractor.apply).toBe("function");
  });
});

describe("isConversationalQuerySource", () => {
  it("treats repl_main_thread + an absent source as conversational", () => {
    expect(isConversationalQuerySource("repl_main_thread")).toBe(true);
    expect(isConversationalQuerySource(null)).toBe(true);
  });

  it("treats utility sources as non-conversational", () => {
    expect(isConversationalQuerySource("generate_session_title")).toBe(false);
    expect(isConversationalQuerySource("prompt_suggestion")).toBe(false);
  });
});

describe("extractAssistantTextFromResponseBody (exported helper)", () => {
  it("lifts concatenated assistant text from content[]", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-7",
      content: [
        {
          type: "text",
          text: "0 files (directory exists but is empty).\n\nUNLOCK-KNOBS-TEST-PROOF-7777",
        },
      ],
    });
    expect(extractAssistantTextFromResponseBody(body)).toBe(
      "0 files (directory exists but is empty).\n\nUNLOCK-KNOBS-TEST-PROOF-7777",
    );
  });

  it("ignores tool_use + thinking blocks, only lifts text blocks", () => {
    const body = JSON.stringify({
      content: [
        { type: "thinking", thinking: "<REDACTED>", signature: "Ev4DCmM..." },
        { type: "text", text: "Let me run that." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    });
    expect(extractAssistantTextFromResponseBody(body)).toBe("Let me run that.");
  });

  it("joins multiple text blocks with a blank line", () => {
    const body = JSON.stringify({
      content: [
        { type: "text", text: "First paragraph." },
        { type: "text", text: "Second paragraph." },
      ],
    });
    expect(extractAssistantTextFromResponseBody(body)).toBe(
      "First paragraph.\n\nSecond paragraph.",
    );
  });

  it("returns null for non-string / empty / malformed / non-array content", () => {
    expect(extractAssistantTextFromResponseBody(undefined)).toBeNull();
    expect(extractAssistantTextFromResponseBody(null)).toBeNull();
    expect(extractAssistantTextFromResponseBody(42)).toBeNull();
    expect(extractAssistantTextFromResponseBody("")).toBeNull();
    expect(extractAssistantTextFromResponseBody("{not valid json")).toBeNull();
    expect(
      extractAssistantTextFromResponseBody(JSON.stringify({})),
    ).toBeNull();
    expect(
      extractAssistantTextFromResponseBody(
        JSON.stringify({ content: "string-not-array" }),
      ),
    ).toBeNull();
    expect(
      extractAssistantTextFromResponseBody(
        JSON.stringify({
          content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }],
        }),
      ),
    ).toBeNull();
  });
});

describe("extractUserTextFromRequestBody (exported helper)", () => {
  it("lifts the latest user turn's text from an array content message", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-7",
      messages: [
        { role: "user", content: [{ type: "text", text: "first turn" }] },
        { role: "assistant", content: [{ type: "text", text: "reply" }] },
        {
          role: "user",
          content: [{ type: "text", text: "Reply with PONG-Y" }],
        },
      ],
    });
    expect(extractUserTextFromRequestBody(body)).toBe("Reply with PONG-Y");
  });

  it("supports a plain-string user content", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "just a string prompt" }],
    });
    expect(extractUserTextFromRequestBody(body)).toBe("just a string prompt");
  });

  it("concatenates multiple text blocks of the last user message", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "line one" },
            { type: "image", source: {} },
            { type: "text", text: "line two" },
          ],
        },
      ],
    });
    expect(extractUserTextFromRequestBody(body)).toBe("line one\n\nline two");
  });

  it("returns null for truncated / malformed / message-less bodies", () => {
    expect(extractUserTextFromRequestBody(undefined)).toBeNull();
    expect(extractUserTextFromRequestBody("")).toBeNull();
    // claude truncates large request bodies inline -> invalid JSON tail.
    expect(
      extractUserTextFromRequestBody('{"model":"x","messages":[{"role":"u'),
    ).toBeNull();
    expect(extractUserTextFromRequestBody(JSON.stringify({}))).toBeNull();
    expect(
      extractUserTextFromRequestBody(
        JSON.stringify({ messages: [{ role: "assistant", content: "x" }] }),
      ),
    ).toBeNull();
  });
});
