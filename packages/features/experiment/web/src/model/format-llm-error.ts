// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

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

const LLM_ERROR_TYPES: ReadonlySet<string> = new Set<LLMErrorType>([
  "not_found",
  "bad_request",
  "auth",
  "rate_limit",
  "connection",
  "unknown",
]);

/**
 * Whether a string off the wire is one of the failure classes we recognise.
 */
export function isLLMErrorType(value: string): value is LLMErrorType {
  return LLM_ERROR_TYPES.has(value);
}

/**
 * Parses litellm error strings into structured data.
 */
export function parseLLMError(raw: string): ParsedLLMError {
  // Try litellm format first
  // Match: litellm.ErrorType: <anything> - <message>
  // The middle part can be "XaiException" or "RateLimitError: XaiException" etc.
  const litellmMatch = raw.match(/litellm\.(\w+):\s*.+?\s+-\s+(.*)/s);
  if (litellmMatch) {
    const [, errorType, rawMessage] = litellmMatch;
    const message = extractJsonMessage(rawMessage ?? raw);
    const type = mapErrorType(errorType ?? "");
    return { type, message };
  }

  // Try Python error format: ErrorType('message', ...)
  const pythonMatch = raw.match(/^(\w+Error|Exception)\('([\s\S]+?)'\)/s);
  if (pythonMatch) {
    const [, errorType, message] = pythonMatch;
    let unescapedMessage = message;
    try {
      if (message) {
        // Unescape Python repr escapes (\\ → \, \' → ', \" → ") in one pass,
        // then JSON-encode so JSON.parse can safely reconstruct the string.
        const pyUnescaped = message.replace(/\\([\\'"])/g, (_, c: string) => c);
        unescapedMessage = JSON.parse(
          `"${pyUnescaped.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
        );
      }
    } catch {}
    return {
      type: "unknown",
      message: unescapedMessage ? `${errorType}\n${unescapedMessage}` : raw,
    };
  }

  return { type: "unknown", message: raw };
}

function extractJsonMessage(raw: string): string {
  if (!raw.trim().startsWith("{")) return raw;

  try {
    const json = JSON.parse(raw);
    // Handle different provider error formats:
    // - Groq/OpenAI: {"error": {"message": "..."}}
    // - XAI/Grok: {"code": "...", "error": "..."} where error is a string
    // - Generic: {"message": "..."}
    if (typeof json.error === "string") {
      return json.error;
    }
    return json.error?.message ?? json.message ?? raw;
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
