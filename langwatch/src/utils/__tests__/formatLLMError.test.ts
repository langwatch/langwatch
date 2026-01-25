import { describe, expect, it } from "vitest";
import { parseLLMError } from "../formatLLMError";

describe("parseLLMError", () => {
  it("parses NotFoundError with correct type", () => {
    const raw =
      "litellm.NotFoundError: OpenAIException - The model 'gpt-5-chat' does not exist or you do not have access to it.";

    expect(parseLLMError(raw)).toEqual({
      type: "not_found",
      message:
        "The model 'gpt-5-chat' does not exist or you do not have access to it.",
    });
  });

  it("parses BadRequestError and extracts nested JSON message", () => {
    const raw = `litellm.BadRequestError: GroqException - {"error":{"message":"'max_tokens' must be less than or equal to '32768'","type":"invalid_request_error","param":"max_tokens"}}`;

    expect(parseLLMError(raw)).toEqual({
      type: "bad_request",
      message: "'max_tokens' must be less than or equal to '32768'",
    });
  });

  it("parses AuthenticationError", () => {
    const raw =
      "litellm.AuthenticationError: OpenAIException - Invalid API key";

    expect(parseLLMError(raw)).toEqual({
      type: "auth",
      message: "Invalid API key",
    });
  });

  it("parses RateLimitError", () => {
    const raw = "litellm.RateLimitError: OpenAIException - Rate limit exceeded";

    expect(parseLLMError(raw)).toEqual({
      type: "rate_limit",
      message: "Rate limit exceeded",
    });
  });

  describe("when parsing XAI/Grok error format", () => {
    it("extracts error string from XaiException JSON", () => {
      const raw = `litellm.RateLimitError: XaiException - {"code":"Some resource has been exhausted","error":"Your team 4cdc57fa-7861-42af-a252-d3f661688f9b has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit."}`;

      expect(parseLLMError(raw)).toEqual({
        type: "rate_limit",
        message:
          "Your team 4cdc57fa-7861-42af-a252-d3f661688f9b has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.",
      });
    });

    it("extracts error string from nested RateLimitError format", () => {
      const raw = `litellm.RateLimitError: RateLimitError: XaiException - {"code":"Some resource has been exhausted","error":"Your team 4cdc57fa-7861-42af-a252-d3f661688f9b has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit."}`;

      expect(parseLLMError(raw)).toEqual({
        type: "rate_limit",
        message:
          "Your team 4cdc57fa-7861-42af-a252-d3f661688f9b has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.",
      });
    });
  });

  it("returns unknown type for non-litellm errors", () => {
    const raw = "Connection refused";

    expect(parseLLMError(raw)).toEqual({
      type: "unknown",
      message: "Connection refused",
    });
  });

  it("handles malformed JSON gracefully", () => {
    const raw = "litellm.BadRequestError: GroqException - {invalid json here}";

    expect(parseLLMError(raw)).toEqual({
      type: "bad_request",
      message: "{invalid json here}",
    });
  });

  it("extracts message from Python SyntaxError", () => {
    const raw = "SyntaxError('unterminated string literal (detected at line 78)')";

    expect(parseLLMError(raw)).toEqual({
      type: "unknown",
      message:
        "SyntaxError\nunterminated string literal (detected at line 78)",
    });
  });

  it("extracts message from Python ValueError", () => {
    const raw = "ValueError('Invalid input')";

    expect(parseLLMError(raw)).toEqual({
      type: "unknown",
      message: "ValueError\nInvalid input",
    });
  });
});
