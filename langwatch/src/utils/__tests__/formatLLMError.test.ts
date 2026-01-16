import { describe, it, expect } from "vitest";
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
    const raw =
      "litellm.RateLimitError: OpenAIException - Rate limit exceeded";

    expect(parseLLMError(raw)).toEqual({
      type: "rate_limit",
      message: "Rate limit exceeded",
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
    const raw =
      "SyntaxError('unterminated string literal (detected at line 78)', ('/var/folders/...'))";

    expect(parseLLMError(raw)).toEqual({
      type: "unknown",
      message: "unterminated string literal (detected at line 78)",
    });
  });

  it("extracts message from Python ValueError", () => {
    const raw = "ValueError('Invalid input')";

    expect(parseLLMError(raw)).toEqual({
      type: "unknown",
      message: "Invalid input",
    });
  });
});
