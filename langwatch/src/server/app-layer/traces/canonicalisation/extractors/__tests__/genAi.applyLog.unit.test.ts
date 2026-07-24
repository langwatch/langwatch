import { describe, expect, it } from "vitest";

import { GenAIExtractor } from "../genAi";
import { createLogExtractorContext } from "./_testHelpers";

const SCOPE = "gen_ai";

describe("GenAIExtractor.applyLog", () => {
  it("lifts every gen_ai.* canonical field a gemini log carries", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "gen_ai.request.model": "gemini-2.0-flash",
      "gen_ai.usage.input_tokens": "150",
      "gen_ai.usage.output_tokens": "30",
      "gen_ai.conversation.id": "conv_xyz",
      "gen_ai.input.messages": '[{"role":"user","content":"What is 2+2?"}]',
      "gen_ai.output.messages": '[{"role":"assistant","content":"4"}]',
      cached_content_token_count: "7",
    });

    new GenAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.model": "gemini-2.0-flash",
      "langwatch.input_tokens": "150",
      "langwatch.output_tokens": "30",
      "langwatch.cache_read_tokens": "7",
      "langwatch.thread.id": "conv_xyz",
      "langwatch.input": '[{"role":"user","content":"What is 2+2?"}]',
      "langwatch.output": '[{"role":"assistant","content":"4"}]',
    });
    expect(ctx.recordRule).toHaveBeenCalledWith("genai:log");
  });

  it("returns no-op when zero gen_ai.* attributes are present", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "event.name": "noise",
      unrelated: "value",
    });

    new GenAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("lifts only fields that are present", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "gen_ai.request.model": "gemini-2.0-pro",
    });

    new GenAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.model": "gemini-2.0-pro",
    });
  });

  it("prefers gen_ai.usage.cache_read_tokens over cached_content_token_count", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "gen_ai.request.model": "gemini-2.0-flash",
      "gen_ai.usage.cache_read_tokens": "100",
      cached_content_token_count: "999",
    });

    new GenAIExtractor().applyLog(ctx);

    expect(ctx.out["langwatch.cache_read_tokens"]).toBe("100");
  });

  it("falls back to cached_content_token_count when canonical key absent", () => {
    const ctx = createLogExtractorContext(SCOPE, {
      "gen_ai.request.model": "gemini-2.0-flash",
      cached_content_token_count: "42",
    });

    new GenAIExtractor().applyLog(ctx);

    expect(ctx.out["langwatch.cache_read_tokens"]).toBe("42");
  });

  it("does not gate on scope name (custom emitters benefit too)", () => {
    const ctx = createLogExtractorContext("com.example.custom_genai", {
      "gen_ai.request.model": "custom-model",
    });

    new GenAIExtractor().applyLog(ctx);

    expect(ctx.out["langwatch.model"]).toBe("custom-model");
  });
});
