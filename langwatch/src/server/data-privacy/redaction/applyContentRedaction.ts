import type { ResolvedDataPrivacy } from "../dataPrivacy.types";
import {
  compileSecretPatterns,
  isSensitiveAttributeKey,
  redactSecretsInText,
  SECRETS_REDACTION_MARKER,
} from "./secretsRedaction";
import { redactEssentialPiiInText } from "./essentialPii";

/**
 * Compose the NATIVE (in-process) redaction passes for a resolved policy: the
 * secrets scrubber (when enabled, including the policy's custom patterns) then
 * essential PII (when the level is `essential`). Strict PII is intentionally NOT
 * here: it stays a batched call to the external analysis service so all of a
 * span's strings go in one request, so the caller runs that separately when the
 * level is `strict`. Disabled PII skips the PII pass entirely; secrets still
 * run when enabled (they are an independent concern).
 *
 * Pure and synchronous so it can run per string in the hot ingestion path.
 */
export function redactStringNative({
  text,
  policy,
  compiledSecretPatterns,
}: {
  text: string;
  policy: ResolvedDataPrivacy;
  compiledSecretPatterns?: readonly RegExp[];
}): { text: string; redactedCount: number } {
  let result = text;
  let redactedCount = 0;

  if (policy.secrets.enabled) {
    const secrets = redactSecretsInText({ text: result, customPatterns: compiledSecretPatterns });
    result = secrets.text;
    redactedCount += secrets.redactedCount;
  }

  if (policy.pii.level === "essential") {
    const pii = redactEssentialPiiInText({ text: result });
    result = pii.text;
    redactedCount += pii.redactedCount;
  }

  return { text: result, redactedCount };
}

/**
 * Redact one attribute (key + value). When secrets redaction is on and the
 * attribute NAME is obviously sensitive (authorization, api_key, cookie, ...),
 * the whole value is replaced regardless of its shape — the Sentry-style
 * field-name deny-list. Otherwise the value runs through the normal native
 * passes (secrets value-scan + essential PII).
 */
export function redactAttributeNative({
  key,
  value,
  policy,
  compiledSecretPatterns,
}: {
  key: string;
  value: string;
  policy: ResolvedDataPrivacy;
  compiledSecretPatterns?: readonly RegExp[];
}): { text: string; redactedCount: number } {
  if (policy.secrets.enabled && value.length > 0 && isSensitiveAttributeKey(key)) {
    return { text: SECRETS_REDACTION_MARKER, redactedCount: 1 };
  }
  return redactStringNative({ text: value, policy, compiledSecretPatterns });
}

/**
 * Whether the resolved policy still needs the external analysis service after
 * the native passes (only the strict PII level does).
 */
export function needsStrictAnalysis(policy: ResolvedDataPrivacy): boolean {
  return policy.pii.level === "strict";
}

/**
 * Compile a resolved policy's custom secret patterns once, for reuse across all
 * of a span's strings.
 */
export function compilePolicySecretPatterns(policy: ResolvedDataPrivacy): RegExp[] {
  return compileSecretPatterns(policy.secrets.customPatterns);
}
