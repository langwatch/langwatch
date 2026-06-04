import { describe, expect, it } from "vitest";

import { ClaudeCodeExtractor } from "../claudeCode";
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
});
