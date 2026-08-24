import { PROVENANCE_ATTR_API_KEY_ID } from "@ee/governance/services/ingestKeyProvenance.utils";
import {
  compileSecretPatterns,
  isSensitiveAttributeKey,
  redactSecretsInText,
  SECRETS_REDACTION_MARKER,
} from "@langwatch/redaction";
import type { ResolvedDataPrivacy } from "../dataPrivacy.types";
import {
  compilePiiExceptPatterns,
  ESSENTIAL_PII_ENTITIES,
  redactEssentialPiiInText,
} from "./essentialPii";

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
 *
 * `isAttributeValue` marks the text as one attribute value, which lets the PII
 * pass hold identifier-shaped values back from the recognizers that have only a
 * shape to go on. Free text (bodies, status messages) leaves it off.
 */
export function redactStringNative({
  text,
  policy,
  compiledSecretPatterns,
  compiledPiiExceptions,
  isAttributeValue = false,
}: {
  text: string;
  policy: ResolvedDataPrivacy;
  compiledSecretPatterns?: readonly RegExp[];
  compiledPiiExceptions?: readonly RegExp[];
  isAttributeValue?: boolean;
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
      exceptPatterns: compiledPiiExceptions,
      isAttributeValue,
    });
    result = pii.text;
    redactedCount += pii.redactedCount;
  }

  return { text: result, redactedCount };
}

/**
 * Attribute names the sensitive-NAME deny-list does not apply to.
 *
 * `langwatch.api_key.id` is exempt. It holds the id of the
 * ApiKey row that authenticated the request, which is not key material, and
 * nuking it to [SECRET] hid the one field that says which key produced a trace.
 *
 * WHAT MAKES THAT EXEMPTION SAFE is not the name, which any client can set on
 * an attribute. It is that the value under this name can never come from the
 * payload: the OTLP receivers rewrite it from the authenticated identity on
 * EVERY authenticated request, dropping any payload-supplied copy at resource,
 * span, event and link level first, and writing the real row id only when one
 * exists (see `enforceApiKeyIdOnTraceRequest` in ingestKeyProvenance.utils.ts).
 * No other ingestion path can produce this attribute name at all, because they
 * build attributes from a fixed key set. So by the time redaction runs, this
 * attribute is receiver-controlled or absent.
 *
 * That invariant is the whole justification. Do not exempt another name without
 * establishing the same thing for it, and do not weaken the receiver-side
 * rewrite to "only when the key looks like an ingestion key" — a conditional
 * rewrite leaves exactly the gap this exemption cannot survive.
 *
 * The value still runs the secret VALUE rules below, so real key material
 * pasted under this name is scrubbed by shape regardless.
 */
const NAME_RULE_EXEMPT_ATTRIBUTES: ReadonlySet<string> = new Set([
  PROVENANCE_ATTR_API_KEY_ID,
]);

/**
 * Redact one attribute (key + value). When secrets redaction is on and the
 * attribute NAME is obviously sensitive (authorization, api_key, cookie, ...),
 * the whole value is replaced regardless of its shape — the Sentry-style
 * field-name deny-list, minus {@link NAME_RULE_EXEMPT_ATTRIBUTES}. Otherwise
 * the value runs through the normal native passes (secrets value-scan +
 * essential PII), marked as an attribute value so the PII pass can hold an
 * identifier-shaped value back from the recognizers that go on shape alone.
 */
export function redactAttributeNative({
  key,
  value,
  policy,
  compiledSecretPatterns,
  compiledPiiExceptions,
}: {
  key: string;
  value: string;
  policy: ResolvedDataPrivacy;
  compiledSecretPatterns?: readonly RegExp[];
  compiledPiiExceptions?: readonly RegExp[];
}): { text: string; redactedCount: number } {
  if (
    policy.secrets.enabled &&
    value.length > 0 &&
    !NAME_RULE_EXEMPT_ATTRIBUTES.has(key) &&
    isSensitiveAttributeKey(key)
  ) {
    return { text: SECRETS_REDACTION_MARKER, redactedCount: 1 };
  }
  return redactStringNative({
    text: value,
    policy,
    compiledSecretPatterns,
    compiledPiiExceptions,
    isAttributeValue: true,
  });
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

/**
 * Compile a resolved policy's PII exception patterns once (anchored to full
 * matches), for reuse across all of a span's strings.
 */
export function compilePolicyPiiExceptions(
  policy: ResolvedDataPrivacy,
): RegExp[] {
  return compilePiiExceptPatterns(policy.pii.exceptPatterns);
}
