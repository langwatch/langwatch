/**
 * Translate the raw Error.message handed to useChat's onError into a
 * user-friendly toast description.
 *
 * Background: the Vercel AI SDK's HttpChatTransport throws
 *   new Error(await response.text())
 * on non-2xx, so what arrives here is the entire response body as a string.
 * The route returns structured JSON for 429 (and possibly other 4xx in the
 * future); this parser extracts a human sentence and falls back gracefully
 * for anything we don't recognize.
 */

type StructuredError = {
  error: {
    code?: string;
    message?: string;
    retryAfterSeconds?: number;
  };
};

type LegacyFlatError = {
  error: string;
};

function isStructured(parsed: unknown): parsed is StructuredError {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "error" in parsed &&
    typeof (parsed as { error: unknown }).error === "object" &&
    (parsed as { error: unknown }).error !== null
  );
}

function isLegacyFlat(parsed: unknown): parsed is LegacyFlatError {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    "error" in parsed &&
    typeof (parsed as { error: unknown }).error === "string"
  );
}

export function parseLangyErrorMessage(raw: string | undefined | null): string {
  if (!raw) return "Langy hit an error. Please try again.";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (isStructured(parsed)) {
    const { code, message, retryAfterSeconds } = parsed.error;
    if (code === "rate_limited") {
      const base = message ?? "Too many messages. Please slow down.";
      return typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
        ? `${base} Retry in ${retryAfterSeconds}s.`
        : base;
    }
    if (typeof message === "string" && message.length > 0) return message;
  }

  if (isLegacyFlat(parsed)) return parsed.error;

  return raw;
}
