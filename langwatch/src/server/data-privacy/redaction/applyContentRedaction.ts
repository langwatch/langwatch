import type { ResolvedDataPrivacy } from "../dataPrivacy.types";
import {
  ESSENTIAL_PII_ENTITIES,
  redactEssentialPiiInText,
} from "./essentialPii";
import {
  compileSecretPatterns,
  isSensitiveAttributeKey,
  redactSecretsInText,
  SECRETS_REDACTION_MARKER,
} from "./secretsRedaction";

const NATIVE_PII_ENTITY_SET: ReadonlySet<string> = new Set(
  ESSENTIAL_PII_ENTITIES,
);

/**
 * The native essential identifiers a resolved policy redacts in-process:
 * `"all"` for the essential and strict levels (the full floor), the selected
 * native subset for custom, or `null` when PII is disabled. Identifiers the
 * native engine cannot detect (names, locations) are not returned here; the
 * caller routes those to the analysis service.
 */
export function nativePiiEntitiesForPolicy(
  policy: ResolvedDataPrivacy,
): "all" | string[] | null {
  switch (policy.pii.level) {
    case "disabled":
      return null;
    case "essential":
    case "strict":
      return "all";
    case "custom":
      return policy.pii.entities.filter((entity) =>
        NATIVE_PII_ENTITY_SET.has(entity),
      );
  }
}

/**
 * Compose the NATIVE (in-process) redaction passes for a resolved policy: the
 * secrets scrubber (when enabled, including the policy's custom patterns) then
 * essential PII (for every non-disabled level). Essential PII is the native
 * floor even at the `strict` level: strict additionally sends the span to the
 * external analysis service for names/locations, but the regex/checksum
 * entities are scrubbed here first so they never leak when that service is
 * unreachable (or simply unconfigured in dev). Disabled PII skips the PII pass
 * entirely; secrets still run when enabled (they are an independent concern).
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
    const secrets = redactSecretsInText({
      text: result,
      customPatterns: compiledSecretPatterns,
    });
    result = secrets.text;
    redactedCount += secrets.redactedCount;
  }

  const piiEntities = nativePiiEntitiesForPolicy(policy);
  if (
    piiEntities !== null &&
    (piiEntities === "all" || piiEntities.length > 0)
  ) {
    const pii = redactEssentialPiiInText({
      text: result,
      entities: piiEntities === "all" ? undefined : piiEntities,
    });
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
  if (
    policy.secrets.enabled &&
    value.length > 0 &&
    isSensitiveAttributeKey(key)
  ) {
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
export function compilePolicySecretPatterns(
  policy: ResolvedDataPrivacy,
): RegExp[] {
  return compileSecretPatterns(policy.secrets.customPatterns);
}
