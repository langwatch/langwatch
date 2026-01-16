export type LLMErrorType =
  | "not_found"
  | "bad_request"
  | "auth"
  | "rate_limit"
  | "connection"
  | "unknown";

export interface ParsedLLMError {
  type: LLMErrorType;
  message: string;
}

/**
 * Parses litellm error strings into structured data.
 * Pattern: "litellm.ErrorType: ProviderException - actual message"
 * Also handles Python-style errors: "ErrorType('message', ...)"
 */
export function parseLLMError(raw: string): ParsedLLMError {
  // Try litellm format first
  const litellmMatch = raw.match(/litellm\.(\w+):\s*\w+\s*-\s*(.*)/s);
  if (litellmMatch) {
    const [, errorType, rawMessage] = litellmMatch;
    const message = extractJsonMessage(rawMessage ?? raw);
    const type = mapErrorType(errorType ?? "");
    return { type, message };
  }

  // Try Python error format: ErrorType('message', ...)
  const pythonMatch = raw.match(/^(\w+Error)\(['"](.+?)['"](?:,|\))/s);
  if (pythonMatch) {
    const [, , message] = pythonMatch;
    return { type: "unknown", message: message ?? raw };
  }

  return { type: "unknown", message: raw };
}

function extractJsonMessage(raw: string): string {
  if (!raw.trim().startsWith("{")) return raw;

  try {
    const json = JSON.parse(raw);
    return json.error?.message ?? raw;
  } catch {
    return raw;
  }
}

function mapErrorType(errorType: string): LLMErrorType {
  const mapping: Record<string, LLMErrorType> = {
    NotFoundError: "not_found",
    BadRequestError: "bad_request",
    AuthenticationError: "auth",
    RateLimitError: "rate_limit",
    APIConnectionError: "connection",
  };
  return mapping[errorType] ?? "unknown";
}
