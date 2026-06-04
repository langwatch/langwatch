import { describe, expect, it } from "vitest";

import { CodexExtractor } from "../codex";
import { createLogExtractorContext } from "./_testHelpers";

const SCOPE = "openai.codex"; // scope-agnostic; gating is on event.name

describe("CodexExtractor.applyLog", () => {
  describe("when the event is codex.sse_event", () => {
    it("lifts model + tokens + cache + thread.id + principal", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "codex.sse_event",
        model: "gpt-5.5",
        input_token_count: "9700",
        output_token_count: "15",
        cached_token_count: "8745",
        "conversation.id": "conv_abc",
        "user.email": "alex@example.com",
      });

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({
        "langwatch.model": "gpt-5.5",
        "langwatch.input_tokens": "9700",
        "langwatch.output_tokens": "15",
        "langwatch.cache_read_tokens": "8745",
        "langwatch.thread.id": "conv_abc",
        "langwatch.principal.email": "alex@example.com",
      });
      expect(ctx.recordRule).toHaveBeenCalledWith("codex/sse_event");
    });

    it("lifts only present fields", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "codex.sse_event",
        model: "gpt-5.5",
        input_token_count: "100",
      });

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({
        "langwatch.model": "gpt-5.5",
        "langwatch.input_tokens": "100",
      });
    });
  });

  describe("when the event is codex.conversation_starts", () => {
    it("lifts model + principal email", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "codex.conversation_starts",
        model: "gpt-5.5",
        "user.email": "alex@example.com",
      });

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({
        "langwatch.model": "gpt-5.5",
        "langwatch.principal.email": "alex@example.com",
      });
      expect(ctx.recordRule).toHaveBeenCalledWith("codex/conversation_starts");
    });
  });

  describe("when the event is codex.user_prompt", () => {
    it("lifts prompt onto langwatch.input", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "codex.user_prompt",
        prompt: "what is 2+2?",
      });

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({
        "langwatch.input": "what is 2+2?",
      });
      expect(ctx.recordRule).toHaveBeenCalledWith("codex/user_prompt");
    });

    it("returns no-op when prompt is missing", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "codex.user_prompt",
      });

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });
  });

  describe("when the event is non-codex", () => {
    it("returns no-op for claude_code.api_request", () => {
      const ctx = createLogExtractorContext(
        "com.anthropic.claude_code.events",
        {
          "event.name": "api_request",
          model: "claude-opus-4-7",
        },
      );

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });

    it("returns no-op for an unknown codex.* event", () => {
      const ctx = createLogExtractorContext(SCOPE, {
        "event.name": "codex.future_event_type",
        model: "gpt-5.5",
      });

      new CodexExtractor().applyLog(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });
  });

  it("span-side apply is a no-op", () => {
    const extractor = new CodexExtractor();
    expect(extractor.id).toBe("codex");
    expect(typeof extractor.apply).toBe("function");
  });
});
