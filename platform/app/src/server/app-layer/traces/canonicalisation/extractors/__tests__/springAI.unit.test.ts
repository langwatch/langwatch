import { describe, expect, it } from "vitest";

import { SpringAIExtractor } from "../springAI";
import { createLogExtractorContext } from "./_testHelpers";

const PROMPT_SCOPE =
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler";
const COMPLETION_SCOPE =
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler";

describe("SpringAIExtractor.applyLog", () => {
  it("lifts prompt body onto langwatch.input", () => {
    const ctx = createLogExtractorContext(
      PROMPT_SCOPE,
      {},
      "Chat Model Prompt Content:\nWhat is the capital of France?",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.input": "What is the capital of France?",
    });
    expect(ctx.recordRule).toHaveBeenCalledWith("spring-ai/prompt");
  });

  it("lifts completion body onto langwatch.output", () => {
    const ctx = createLogExtractorContext(
      COMPLETION_SCOPE,
      {},
      "Chat Model Completion:\nParis.",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({ "langwatch.output": "Paris." });
    expect(ctx.recordRule).toHaveBeenCalledWith("spring-ai/completion");
  });

  it("returns no-op for a non-spring-ai scope", () => {
    const ctx = createLogExtractorContext(
      "com.anthropic.claude_code.events",
      {},
      "Chat Model Prompt Content:\nignored",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
    expect(ctx.recordRule).not.toHaveBeenCalled();
  });

  it("returns no-op when body identifier is unrecognised", () => {
    const ctx = createLogExtractorContext(
      PROMPT_SCOPE,
      {},
      "Unknown Identifier:\nsome content",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
  });

  it("returns no-op when body has no newline separator", () => {
    const ctx = createLogExtractorContext(
      PROMPT_SCOPE,
      {},
      "Chat Model Prompt Content: missing newline",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
  });

  it("returns no-op when content after identifier is empty", () => {
    const ctx = createLogExtractorContext(
      PROMPT_SCOPE,
      {},
      "Chat Model Prompt Content:\n",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({});
  });

  it("preserves multi-line content after the identifier", () => {
    const ctx = createLogExtractorContext(
      COMPLETION_SCOPE,
      {},
      "Chat Model Completion:\nLine 1\nLine 2\nLine 3",
    );

    new SpringAIExtractor().applyLog(ctx);

    expect(ctx.out).toEqual({
      "langwatch.output": "Line 1\nLine 2\nLine 3",
    });
  });
});
