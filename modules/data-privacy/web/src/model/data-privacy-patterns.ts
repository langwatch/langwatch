import { overBroadSecretPatternProbe } from "@langwatch/redaction";
import safe from "safe-regex2";

/**
 * Whether a pattern a customer typed is safe to run, and safe to run on TRACES.
 *
 * `isSafeRegex` is a family-local copy of `platform/app/src/utils/safeRegex.ts`.
 * That module has six non-family callers — the cost drawer, the matching-spans
 * view, the model-provider router and two ingestion paths — and the migration
 * ruling forbids repointing them, so the copy is what travels. It is the same
 * `safe-regex2` verdict the server applies at the write boundary, which is what
 * keeps the form and the runtime from disagreeing.
 *
 * The over-broad probe is a SECOND check and only the custom-secret input runs
 * it: a secret pattern that also matches ordinary prose rewrites trace content
 * at ingestion, and that is not recoverable. The probe is the pipeline's own, so
 * this page cannot promise something different from what actually happens.
 */

/** Compiles a pattern, and hands it back only if it cannot backtrack catastrophically. */
export function compileSafeRegex(pattern: string): RegExp | null {
  try {
    const expression = new RegExp(pattern);
    return safe(expression) ? expression : null;
  } catch {
    return null;
  }
}

/** The pass/fail verdict, for call sites that need nothing else. */
export function isSafeRegex(pattern: string): boolean {
  return compileSafeRegex(pattern) !== null;
}

/** Why a redaction pattern cannot be used, or null when it can. */
export function secretPatternError(pattern: string): string | null {
  if (pattern.trim().length === 0) return null;
  try {
    new RegExp(pattern);
  } catch {
    return "Invalid regular expression";
  }
  if (!isSafeRegex(pattern)) {
    return "Pattern could backtrack catastrophically; simplify it";
  }
  return null;
}

/** The custom-secret input's stricter verdict: safe to run, and not over-broad. */
export function customSecretPatternError(pattern: string): string | null {
  const invalid = secretPatternError(pattern);
  if (invalid) return invalid;
  const eaten = overBroadSecretPatternProbe(pattern);
  return eaten ? `Too broad: this also matches ordinary text like ${eaten}` : null;
}

/** Why an attribute-key pattern cannot be used, or null when it can. */
export function attributePatternError(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.replaceAll("*", "").length === 0) {
    return "Name at least part of the key";
  }
  return null;
}
