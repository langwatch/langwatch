import { describe, expect, it } from "vitest";

import {
  buildInputMessagesFromRequestBody,
  ClaudeCodeExtractor,
  collectToolResultsFromRequestBody,
  extractAssistantOutputFromResponseBody,
  extractAssistantTextFromResponseBody,
  extractUserTextFromRequestBody,
  isConversationalQuerySource,
  recoverInputMessagesFromTruncatedBody,
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
    expect(extractAssistantTextFromResponseBody(JSON.stringify({}))).toBeNull();
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

describe("buildInputMessagesFromRequestBody (exported helper)", () => {
  it("parses system + every turn into a role/content conversation", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-8",
      system: "You are a coding assistant.",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      ],
    });
    expect(buildInputMessagesFromRequestBody(body)).toEqual([
      { role: "system", content: "You are a coding assistant." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("flattens text + tool_result + tool_use blocks; drops thinking/images", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            {
              type: "tool_result",
              content: [{ type: "text", text: "result" }],
            },
            { type: "tool_use", name: "Read", input: { path: "x" } },
            { type: "thinking", thinking: "<redacted>" },
            { type: "image", source: {} },
          ],
        },
      ],
    });
    expect(buildInputMessagesFromRequestBody(body)).toEqual([
      { role: "user", content: "look at this\n\nresult\n\n[tool_use: Read]" },
    ]);
  });

  it("flattens a system array of content blocks", () => {
    const body = JSON.stringify({
      system: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
      messages: [{ role: "user", content: "go" }],
    });
    expect(buildInputMessagesFromRequestBody(body)).toEqual([
      { role: "system", content: "line one\n\nline two" },
      { role: "user", content: "go" },
    ]);
  });

  it("returns null for empty / message-less bodies", () => {
    expect(buildInputMessagesFromRequestBody(undefined)).toBeNull();
    expect(buildInputMessagesFromRequestBody("")).toBeNull();
    expect(buildInputMessagesFromRequestBody(JSON.stringify({}))).toBeNull();
    // messages present but every turn flattens to empty -> null.
    expect(
      buildInputMessagesFromRequestBody(
        JSON.stringify({ messages: [{ role: "user", content: [] }] }),
      ),
    ).toBeNull();
    // Truncated before any complete turn and no system -> nothing to recover.
    expect(
      buildInputMessagesFromRequestBody('{"model":"x","messages":[{"role":"u'),
    ).toBeNull();
  });

  it("recovers system + complete leading turns from a body truncated in the last turn", () => {
    // The real failure mode: claude cut the ~60KB body inside the newest turn.
    // The front-loaded system prompt and the earlier complete turns survive and
    // must be recovered so the cost classifier does not strand the cached prefix
    // in other_input.
    const full = JSON.stringify({
      model: "claude-fable-5",
      system: [
        {
          type: "text",
          text: "You are helpful",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "first question" },
        {
          role: "assistant",
          content: [{ type: "text", text: "first answer" }],
        },
        { role: "user", content: "second question, now cut off partway" },
      ],
    });
    const truncated = full.slice(0, full.indexOf("second question") + 6);

    expect(buildInputMessagesFromRequestBody(truncated)).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      // the truncated third turn never balances and is dropped
    ]);
  });
});

describe("recoverInputMessagesFromTruncatedBody (exported helper)", () => {
  it("recovers complete leading system blocks when the system array itself is cut", () => {
    const full = JSON.stringify({
      system: [
        { type: "text", text: "block one" },
        { type: "text", text: "block two, cut here somewhere long" },
      ],
      messages: [{ role: "user", content: "go" }],
    });
    // Cut inside the SECOND system block's text (before it closes).
    const truncated = full.slice(0, full.indexOf("cut here"));

    expect(recoverInputMessagesFromTruncatedBody(truncated)).toEqual([
      { role: "system", content: "block one" },
    ]);
  });

  it("keeps brace/quote characters inside content from corrupting the scan", () => {
    const full = JSON.stringify({
      messages: [
        { role: "user", content: 'a message with { braces } and a "quote"' },
        { role: "assistant", content: "clean reply" },
        { role: "user", content: "cut here" },
      ],
    });
    const truncated = full.slice(0, full.indexOf("cut here") + 3);

    expect(recoverInputMessagesFromTruncatedBody(truncated)).toEqual([
      { role: "user", content: 'a message with { braces } and a "quote"' },
      { role: "assistant", content: "clean reply" },
    ]);
  });

  it("returns null when nothing complete survives", () => {
    expect(
      recoverInputMessagesFromTruncatedBody('{"messages":[{"role":"u'),
    ).toBeNull();
  });
});

describe("extractAssistantOutputFromResponseBody", () => {
  it("renders a tool_use reply as the output so a tool-deciding call is not empty", () => {
    const body = JSON.stringify({
      content: [
        { type: "text", text: "Let me check." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "ls /tmp" },
        },
      ],
    });
    const out = extractAssistantOutputFromResponseBody(body) ?? "";
    expect(out).toContain("Let me check.");
    expect(out).toContain("[tool_use: Bash]");
    expect(out).toContain("ls /tmp");
  });

  it("matches the text-only extractor for a plain text reply", () => {
    const body = JSON.stringify({
      content: [{ type: "text", text: "PONG-Z" }],
    });
    expect(extractAssistantOutputFromResponseBody(body)).toBe("PONG-Z");
    expect(extractAssistantTextFromResponseBody(body)).toBe("PONG-Z");
  });

  it("returns null for an empty or unparseable body", () => {
    expect(extractAssistantOutputFromResponseBody("")).toBeNull();
    expect(extractAssistantOutputFromResponseBody("{not json")).toBeNull();
    expect(extractAssistantOutputFromResponseBody(null)).toBeNull();
  });
});

describe("collectToolResultsFromRequestBody", () => {
  // Real wire shape (from raw dumps): the tool_result block keys are
  // `tool_use_id`, `type`, `content` (a plain string for Bash), `is_error`.
  const bashResult = (toolUseId: string, content: string) => ({
    tool_use_id: toolUseId,
    type: "tool_result",
    content,
    is_error: false,
  });

  it("maps each tool_use_id to its result text from a whole, parseable body", () => {
    const body = JSON.stringify({
      model: "claude-opus-4-7",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_a", name: "Bash", input: {} },
          ],
        },
        { role: "user", content: [bashResult("toolu_a", "       0")] },
      ],
    });
    const map = collectToolResultsFromRequestBody(body);
    expect(map.get("toolu_a")).toBe("       0");
  });

  it("handles array-form content (Read-style) as well as string content", () => {
    const body = JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_read",
              type: "tool_result",
              content: [{ type: "text", text: "file contents here" }],
            },
          ],
        },
      ],
    });
    expect(collectToolResultsFromRequestBody(body).get("toolu_read")).toBe(
      "file contents here",
    );
  });

  it("recovers complete tool_results from a 60KB-truncated body and skips the cut-off tail", () => {
    // Claude truncates the request body inline (~60KB, body_truncated=true), so
    // the whole body does NOT JSON.parse. Everything before the cut is still
    // recoverable; the final, half-written tool_result is not.
    const full = JSON.stringify({
      model: "claude-opus-4-7",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_first", name: "Bash", input: {} },
          ],
        },
        { role: "user", content: [bashResult("toolu_first", "first-result")] },
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_last", name: "Bash", input: {} },
          ],
        },
        {
          role: "user",
          content: [bashResult("toolu_last", "SECOND_RESULT_CUT_HERE")],
        },
      ],
    });
    const truncated = full.slice(0, full.indexOf("SECOND_RESULT_CUT_HERE") + 6);
    // Sanity: the truncated body is genuinely not valid JSON.
    expect(() => JSON.parse(truncated)).toThrow();

    const map = collectToolResultsFromRequestBody(truncated);
    expect(map.get("toolu_first")).toBe("first-result");
    expect(map.has("toolu_last")).toBe(false);
  });

  it("returns an empty map for a body with no tool_results", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(collectToolResultsFromRequestBody(body).size).toBe(0);
    expect(collectToolResultsFromRequestBody("").size).toBe(0);
    expect(collectToolResultsFromRequestBody(null).size).toBe(0);
  });
});
