/**
 * Classifies a generation error into a tier with tailored copy and a recovery CTA.
 *
 * Tier-1: known error shapes → specific, actionable copy.
 * Tier-2 (unknown): generic copy + raw backend message verbatim.
 */
import { ScenarioGenerationError } from "../services/scenarioGeneration";

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
/**
 * Formats a typed generation error for display: its kind, the message
 * when it adds information beyond the kind, and every meta entry —
 * e.g. `bad_request (reason: missing_provider)`. This is what the
 * tier-2 raw-message surface shows for handled backend failures, so
 * the user sees the discriminant, not just an opaque status word.
 */
function describeGenerationError(error: ScenarioGenerationError): string {
  const head =
    error.message && error.message !== error.kind
      ? `${error.kind}: ${error.message}`
      : error.kind;
  const meta = Object.entries(error.meta)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
  return meta ? `${head} (${meta})` : head;
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof ScenarioGenerationError) {
    return describeGenerationError(error);
  }

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
 * Maps a `ScenarioGenerationError.kind` (the stable discriminant the
 * generate endpoint forwards from handled gateway failures) to a
 * classified tier. Returns null for kinds without tailored copy so
 * they fall through to message matching.
 */
function classifyByKind(error: ScenarioGenerationError): GenerationErrorClass | null {
  switch (error.kind) {
    case "missing_provider":
      return {
        tier: "config",
        cta: "configure",
        copy: "The default model's provider isn't supported for generation. Choose a different default model to continue.",
      };
    default:
      return null;
  }
}

/**
 * Maps a generation error to a classified tier with tailored copy and a recovery CTA.
 *
 * Typed errors from the generate endpoint are matched on their `kind`
 * first; everything else falls back to case-insensitive regex matching
 * against the extracted message string.
 */
export function classifyGenerationError(error: unknown): GenerationErrorClass {
  if (error instanceof ScenarioGenerationError) {
    const byKind = classifyByKind(error);
    if (byKind) return byKind;
  }

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

  if (/timeout|timed out/i.test(message)) {
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
