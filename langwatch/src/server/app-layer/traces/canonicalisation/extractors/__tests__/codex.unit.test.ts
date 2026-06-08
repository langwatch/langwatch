import { describe, expect, it } from "vitest";

import { CodexExtractor } from "../codex";
import {
  createExtractorContext,
  createLogExtractorContext,
} from "./_testHelpers";

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

  describe("CodexExtractor.apply (span side)", () => {
    it("lifts codex.turn.token_usage.* + model + turn.id off the codex_cli_rs session_task.turn span", () => {
      const ctx = createExtractorContext(
        {
          model: "gpt-5.5",
          "codex.turn.token_usage.input_tokens": "14365",
          "codex.turn.token_usage.output_tokens": "6",
          "codex.turn.token_usage.cached_input_tokens": "10112",
          "codex.turn.token_usage.total_tokens": "14371",
          "codex.turn.reasoning_effort": "high",
          "turn.id": "019e939c-48a1-7021-a71d-714f74d6ad64",
        },
        {
          name: "session_task.turn",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out).toEqual({
        "gen_ai.request.model": "gpt-5.5",
        "gen_ai.response.model": "gpt-5.5",
        "gen_ai.usage.input_tokens": 14365,
        "gen_ai.usage.output_tokens": 6,
        "gen_ai.usage.cache_read.input_tokens": 10112,
        "gen_ai.request.reasoning_effort": "high",
        "gen_ai.conversation.id": "019e939c-48a1-7021-a71d-714f74d6ad64",
      });
      expect(ctx.recordRule).toHaveBeenCalledWith("codex/session_task.turn");
    });

    /** @scenario "Codex reasoning effort is canonicalised from the turn span" */
    it("canonicalises codex.turn.reasoning_effort to gen_ai.request.reasoning_effort", () => {
      const ctx = createExtractorContext(
        {
          model: "gpt-5.5",
          "codex.turn.reasoning_effort": "high",
        },
        {
          name: "session_task.turn",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out["gen_ai.request.reasoning_effort"]).toBe("high");
    });

    /** @scenario "Codex reasoning output tokens are captured" */
    it("lifts codex.turn.token_usage.reasoning_output_tokens to gen_ai.usage.reasoning_tokens", () => {
      const ctx = createExtractorContext(
        {
          model: "gpt-5.5",
          "codex.turn.token_usage.input_tokens": "1000",
          "codex.turn.token_usage.output_tokens": "50",
          "codex.turn.token_usage.reasoning_output_tokens": "10",
        },
        {
          name: "session_task.turn",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out["gen_ai.usage.reasoning_tokens"]).toBe(10);
    });

    it("flags a non-turn codex span carrying usage as a redundant token copy", () => {
      const ctx = createExtractorContext(
        {
          "gen_ai.usage.input_tokens": 13297,
          "gen_ai.usage.output_tokens": 23,
        },
        {
          name: "handle_responses",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out["langwatch.reserved.skip_token_accumulation"]).toBe("true");
    });

    it("does not flag a non-turn codex span without usage", () => {
      const ctx = createExtractorContext(
        { "code.module.name": "session" },
        {
          name: "build_tool_call",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(
        ctx.out["langwatch.reserved.skip_token_accumulation"],
      ).toBeUndefined();
    });

    it("is a no-op for codex_cli_rs spans other than session_task.turn", () => {
      const ctx = createExtractorContext(
        {
          model: "gpt-5.5",
          "turn_id": "abc",
        },
        {
          name: "run_sampling_request",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });

    it("is a no-op for non-codex scopes (Path A gen_ai.* spans are GenAIExtractor's lane)", () => {
      const ctx = createExtractorContext(
        {
          "gen_ai.request.model": "gpt-5.5",
          "gen_ai.usage.input_tokens": "100",
        },
        {
          name: "session_task.turn",
          instrumentationScope: {
            name: "@langwatch/aigateway",
            version: null,
          },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });

    it("lifts only present fields", () => {
      const ctx = createExtractorContext(
        {
          model: "gpt-5.5",
        },
        {
          name: "session_task.turn",
          instrumentationScope: { name: "codex_cli_rs", version: null },
        },
      );

      new CodexExtractor().apply(ctx);

      expect(ctx.out).toEqual({
        "gen_ai.request.model": "gpt-5.5",
        "gen_ai.response.model": "gpt-5.5",
      });
      expect(ctx.recordRule).toHaveBeenCalledWith("codex/session_task.turn");
    });
  });
});
