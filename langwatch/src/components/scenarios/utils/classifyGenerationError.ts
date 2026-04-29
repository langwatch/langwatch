/**
 * Classifies a generation error into a tier with tailored copy and a recovery CTA.
 *
 * Tier-1: known error shapes → specific, actionable copy.
 * Tier-2 (unknown): generic copy + raw backend message verbatim.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GenerationErrorClass =
  | { tier: "config"; cta: "configure"; copy: string }
  | { tier: "auth"; cta: "configure"; copy: string }
  | { tier: "rate-limit"; cta: "configure-and-retry"; copy: string }
  | { tier: "timeout"; cta: "retry"; copy: string }
  | { tier: "unknown"; cta: "retry-or-skip"; copy: string; rawMessage: string };

// ─────────────────────────────────────────────────────────────────────────────
// Message extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts a plain string message from an arbitrary unknown error value.
 *
 * Handles:
 * - Error instances (including TRPCClientError, which extends Error)
 * - Plain strings
 * - Everything else via String()
 */
function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    // TRPCClientError stores the server message in error.message already,
    // but also exposes data.message on some shapes. Prefer data.message when present.
    const trpcLike = error as Error & {
      data?: { message?: string };
    };
    if (trpcLike.data?.message) {
      return trpcLike.data.message;
    }
    return error.message;
  }

  return String(error);
}

// ─────────────────────────────────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a generation error to a classified tier with tailored copy and a recovery CTA.
 *
 * Regex matching is performed case-insensitively against the extracted message string.
 */
export function classifyGenerationError(error: unknown): GenerationErrorClass {
  const message = extractMessage(error);

  if (/no default model/i.test(message)) {
    return {
      tier: "config",
      cta: "configure",
      copy: "Your project has no default model configured. Set one to continue.",
    };
  }

  if (/no.*provider|provider.*not.*configured/i.test(message)) {
    return {
      tier: "config",
      cta: "configure",
      copy: "No model provider is configured. Add one to continue.",
    };
  }

  if (/stale|provider.*disabled/i.test(message)) {
    return {
      tier: "config",
      cta: "configure",
      copy: "The configured default model's provider is disabled. Reconfigure to continue.",
    };
  }

  if (/invalid api key|authentication|unauthorized/i.test(message)) {
    return {
      tier: "auth",
      cta: "configure",
      copy: "There was a problem reaching your model provider. Check your provider configuration and that your API key is correct.",
    };
  }

  if (/rate limit|quota/i.test(message)) {
    return {
      tier: "rate-limit",
      cta: "configure-and-retry",
      copy: "Rate limit reached on your provider. Wait a moment or check your provider's usage settings.",
    };
  }

  if (/timeout/i.test(message)) {
    return {
      tier: "timeout",
      cta: "retry",
      copy: "The generation request timed out. Try again — the backend may be slow.",
    };
  }

  return {
    tier: "unknown",
    cta: "retry-or-skip",
    copy: "Something went wrong while generating your scenario.",
    rawMessage: message,
  };
}
