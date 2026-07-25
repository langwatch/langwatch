import { describe, expect, it } from "vitest";

import {
  buildInputMessagesFromRequestBody,
  ClaudeCodeExtractor,
  extractAssistantOutputFromResponseBody,
  extractAssistantTextFromResponseBody,
  isConversationalQuerySource,
} from "../claudeCode";
import {
  createExtractorContext,
  createLogExtractorContext,
} from "./_testHelpers";

const SCOPE = "com.anthropic.claude_code.events";

describe("ClaudeCodeExtractor.applyLog", () => {
  // The model-call events (api_request / api_request_body / api_response_body)
  // are folded downstream from the log path itself, not lifted onto canonical
  // attributes here. The only claude_code event this extractor lifts is
  // user_prompt.

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

  it("does NOT lift the model-call events on the log path", () => {
    // api_request is folded downstream; this extractor must NOT re-lift
    // cost/tokens onto the fold (that would double-count). It ignores it.
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
});

describe("ClaudeCodeExtractor.apply (span side)", () => {
  it("lifts the CLI's bare-named token + model attrs onto canonical gen_ai.usage.* on the native llm_request span", () => {
    const ctx = createExtractorContext(
      {
        model: "claude-opus-4-7",
        input_tokens: 120,
        output_tokens: 45,
        cache_read_tokens: 900,
        cache_creation_tokens: 30,
      },
      { name: "claude_code.llm_request" },
    );

    new ClaudeCodeExtractor().apply(ctx);

    expect(ctx.out).toEqual({
      "gen_ai.request.model": "claude-opus-4-7",
      "gen_ai.usage.input_tokens": 120,
      "gen_ai.usage.output_tokens": 45,
      "gen_ai.usage.cache_read.input_tokens": 900,
      "gen_ai.usage.cache_creation.input_tokens": 30,
    });
    expect(ctx.recordRule).toHaveBeenCalledWith("claude-code/llm_request");
  });

  it("does nothing for a span that isn't claude_code.llm_request", () => {
    // Gateway-proxied traffic (and every other claude_code span, like the
    // tool span) must not be touched here — this method exists ONLY for the
    // CLI's own native model-call span.
    const ctx = createExtractorContext(
      { model: "claude-opus-4-7", input_tokens: 120 },
      { name: "claude_code.tool" },
    );

    new ClaudeCodeExtractor().apply(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("never overwrites a canonical attribute a gateway-proxied gen_ai.* span already set", () => {
    // setAttrIfAbsent semantics: if GenAIExtractor (or an earlier rule) already
    // claimed the canonical key, this extractor must not clobber it.
    const ctx = createExtractorContext(
      { input_tokens: 999 },
      { name: "claude_code.llm_request" },
    );
    ctx.out["gen_ai.usage.input_tokens"] = 10;

    new ClaudeCodeExtractor().apply(ctx);

    expect(ctx.out["gen_ai.usage.input_tokens"]).toBe(10);
  });

  it("does not fire for a zero-valued token count", () => {
    const ctx = createExtractorContext(
      { input_tokens: 0, output_tokens: 0 },
      { name: "claude_code.llm_request" },
    );

    new ClaudeCodeExtractor().apply(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
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

  it("returns null for truncated / malformed / message-less bodies", () => {
    expect(buildInputMessagesFromRequestBody(undefined)).toBeNull();
    expect(buildInputMessagesFromRequestBody("")).toBeNull();
    // claude truncates large request bodies inline -> invalid JSON tail.
    expect(
      buildInputMessagesFromRequestBody('{"model":"x","messages":[{"role":"u'),
    ).toBeNull();
    expect(buildInputMessagesFromRequestBody(JSON.stringify({}))).toBeNull();
    // messages present but every turn flattens to empty -> null.
    expect(
      buildInputMessagesFromRequestBody(
        JSON.stringify({ messages: [{ role: "user", content: [] }] }),
      ),
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
