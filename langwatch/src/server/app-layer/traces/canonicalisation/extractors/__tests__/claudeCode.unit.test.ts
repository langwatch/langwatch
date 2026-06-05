import { describe, expect, it } from "vitest";

import {
  ClaudeCodeExtractor,
  extractAssistantTextFromResponseBody,
} from "../claudeCode";
import { createLogExtractorContext } from "./_testHelpers";

const SCOPE = "com.anthropic.claude_code.events";

describe("ClaudeCodeExtractor.applyLog", () => {
  it("lifts model + cost + tokens + cache split off a claude_code.api_request event", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "api_request",
      model: "claude-opus-4-7",
      cost_usd: "0.0875",
      input_tokens: "120",
      output_tokens: "30",
      cache_read_tokens: "58142",
      cache_creation_tokens: "1024",
      "session.id": "sess_abc",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.model": "claude-opus-4-7",
      "langwatch.cost.usd": "0.0875",
      "langwatch.input_tokens": "120",
      "langwatch.output_tokens": "30",
      "langwatch.cache_read_tokens": "58142",
      "langwatch.cache_creation_tokens": "1024",
      "langwatch.thread.id": "sess_abc",
    });
    expect(ctx.recordRule).toHaveBeenCalledWith("claude-code/api_request");
  });

  it("returns no-op for a non-claude_code scope", () => {
    const ctx = createLogExtractorContext("com.openai.codex.events", {
      "event.name": "api_request",
      model: "gpt-5.5",
      cost_usd: "0.05",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

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

  it("returns no-op for an unknown event in claude_code scope", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "tool_decision",
      tool_name: "Bash",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("lifts only fields that are present (partial wire shape)", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "api_request",
      model: "claude-haiku-4-5-20251001",
      input_tokens: "462",
      output_tokens: "39",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.model": "claude-haiku-4-5-20251001",
      "langwatch.input_tokens": "462",
      "langwatch.output_tokens": "39",
    });
    expect(ctx.recordRule).toHaveBeenCalledOnce();
  });

  it("ignores malformed numeric strings without crashing", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "api_request",
      model: "claude-opus-4-7",
      cost_usd: "not-a-number",
      input_tokens: "",
    });

    new ClaudeCodeExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.model": "claude-opus-4-7",
    });
  });

  it("span-side apply is a no-op (Path A flows through GenAIExtractor)", () => {
    const extractor = new ClaudeCodeExtractor();
    expect(extractor.id).toBe("claude-code");
    // applyLog is present but apply is intentionally a no-op
    expect(typeof extractor.apply).toBe("function");
  });

  describe("when the event is api_response_body (OTEL_LOG_RAW_API_BODIES=1)", () => {
    it("lifts concatenated assistant text from content[] onto langwatch.output", () => {
      // Real shape from a live raw OTLP intercept on 2026-06-04:
      // claude-code 2.x with OTEL_LOG_RAW_API_BODIES=1 emits an
      // api_response_body event per turn carrying the full anthropic
      // /v1/messages response body as a JSON string in `body`. We
      // walk content[] and lift every `type === "text"` block.
      const body = JSON.stringify({
        model: "claude-opus-4-7",
        id: "msg_01",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "0 files (directory exists but is empty).\n\nUNLOCK-KNOBS-TEST-PROOF-7777",
          },
        ],
      });
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "api_response_body",
        body,
        "session.id": "sess_resp",
      });

      new ClaudeCodeExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({
        "langwatch.output":
          "0 files (directory exists but is empty).\n\nUNLOCK-KNOBS-TEST-PROOF-7777",
        "langwatch.thread.id": "sess_resp",
      });
      expect(ctx.recordRule).toHaveBeenCalledWith(
        "claude-code/api_response_body",
      );
    });

    it("ignores tool_use + thinking blocks, only lifts text blocks", () => {
      // The response body also carries `tool_use` (invocations) and
      // `thinking` (always REDACTED by anthropic) blocks. Neither
      // belongs in langwatch.output — tool invocations surface via
      // tool_decision/tool_result events, and thinking is empty.
      const body = JSON.stringify({
        content: [
          {
            type: "thinking",
            thinking: "<REDACTED>",
            signature: "Ev4DCmM...",
          },
          { type: "text", text: "Let me run that." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "ls", description: "List files" },
          },
        ],
      });
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "api_response_body",
        body,
      });

      new ClaudeCodeExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({
        "langwatch.output": "Let me run that.",
      });
    });

    it("joins multiple text blocks with a blank line", () => {
      const body = JSON.stringify({
        content: [
          { type: "text", text: "First paragraph." },
          { type: "text", text: "Second paragraph." },
        ],
      });
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "api_response_body",
        body,
      });

      new ClaudeCodeExtractor().applyLog(ctx);

      expect(ctx.out["langwatch.output"]).toBe(
        "First paragraph.\n\nSecond paragraph.",
      );
    });

    it("returns no-op when body is malformed JSON", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "api_response_body",
        body: "{not valid json",
      });

      new ClaudeCodeExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });

    it("returns no-op when content[] has no text blocks", () => {
      const body = JSON.stringify({
        content: [
          { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
        ],
      });
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "api_response_body",
        body,
      });

      new ClaudeCodeExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });

    it("does NOT overwrite a thread.id already set by an earlier event", () => {
      const body = JSON.stringify({
        content: [{ type: "text", text: "hi" }],
      });
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "api_response_body",
        body,
        "session.id": "sess_new",
      });
      ctx.out["langwatch.thread.id"] = "sess_earlier";

      new ClaudeCodeExtractor().applyLog(ctx);

      expect(ctx.out["langwatch.thread.id"]).toBe("sess_earlier");
      expect(ctx.out["langwatch.output"]).toBe("hi");
    });

    describe("when the api_response_body is a non-conversational utility call", () => {
      // claude-code emits api_response_body for utility model calls too
      // (the greyed-out autosuggest, the session-title generator, quota
      // probes). Their text is NOT the assistant's reply to the user and
      // would clobber the headline ComputedOutput (the fold is last-write-
      // wins), so we skip the output lift but keep thread.id correlation.
      it("skips langwatch.output for query_source=prompt_suggestion (the autosuggest)", () => {
        const body = JSON.stringify({
          content: [{ type: "text", text: "run ls /tmp again" }],
        });
        const ctx = createLogExtractorContext(SCOPE, {
          "event.name": "api_response_body",
          query_source: "prompt_suggestion",
          body,
          "session.id": "sess_sugg",
        });

        new ClaudeCodeExtractor().applyLog(ctx);

        // No output lift, but the trace stays stitched via thread.id.
        expect(ctx.out["langwatch.output"]).toBeUndefined();
        expect(ctx.out["langwatch.thread.id"]).toBe("sess_sugg");
        expect(ctx.recordRule).toHaveBeenCalledWith(
          "claude-code/api_response_body",
        );
      });

      it("skips langwatch.output for query_source=generate_session_title", () => {
        const body = JSON.stringify({
          content: [
            { type: "text", text: '{"title": "List temporary directory"}' },
          ],
        });
        const ctx = createLogExtractorContext(SCOPE, {
          "event.name": "api_response_body",
          query_source: "generate_session_title",
          body,
        });

        new ClaudeCodeExtractor().applyLog(ctx);

        expect(ctx.out["langwatch.output"]).toBeUndefined();
      });

      it("lifts langwatch.output for query_source=repl_main_thread (the real conversation)", () => {
        const body = JSON.stringify({
          content: [{ type: "text", text: "I see three entries." }],
        });
        const ctx = createLogExtractorContext(SCOPE, {
          "event.name": "api_response_body",
          query_source: "repl_main_thread",
          body,
        });

        new ClaudeCodeExtractor().applyLog(ctx);

        expect(ctx.out["langwatch.output"]).toBe("I see three entries.");
      });
    });
  });

  describe("extractAssistantTextFromResponseBody (exported helper)", () => {
    it("returns null for non-string body", () => {
      expect(extractAssistantTextFromResponseBody(undefined)).toBeNull();
      expect(extractAssistantTextFromResponseBody(null)).toBeNull();
      expect(extractAssistantTextFromResponseBody(42)).toBeNull();
      expect(extractAssistantTextFromResponseBody({})).toBeNull();
    });
    it("returns null for empty string", () => {
      expect(extractAssistantTextFromResponseBody("")).toBeNull();
    });
    it("returns null when content key missing", () => {
      expect(
        extractAssistantTextFromResponseBody(JSON.stringify({})),
      ).toBeNull();
    });
    it("returns null when content is not an array", () => {
      expect(
        extractAssistantTextFromResponseBody(
          JSON.stringify({ content: "string-not-array" }),
        ),
      ).toBeNull();
    });
    it("skips text blocks with empty text", () => {
      expect(
        extractAssistantTextFromResponseBody(
          JSON.stringify({
            content: [
              { type: "text", text: "" },
              { type: "text", text: "real" },
            ],
          }),
        ),
      ).toBe("real");
    });
  });
});
