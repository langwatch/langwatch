import {
  compileSecretPatterns,
  isSensitiveAttributeKey,
  redactSecretsInText,
  SECRETS_REDACTION_MARKER,
  SHAPE_ONLY_SECRET_RULE_IDS,
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
 *
 * `skipSecretRuleIds` names built-in secret rules to leave out of this one
 * string while the policy stays on, for the attribute names
 * {@link isIdentifierAttributeName} accepts. Custom patterns and the PII pass
 * are out of its reach.
 */
export function redactStringNative({
  text,
  policy,
  compiledSecretPatterns,
  compiledPiiExceptions,
  isAttributeValue = false,
  skipSecretRuleIds,
}: {
  text: string;
  policy: ResolvedDataPrivacy;
  compiledSecretPatterns?: readonly RegExp[];
  compiledPiiExceptions?: readonly RegExp[];
  isAttributeValue?: boolean;
  skipSecretRuleIds?: readonly string[];
}): { text: string; redactedCount: number } {
  let result = text;
  let redactedCount = 0;

  if (policy.secrets.enabled) {
    const secrets = redactSecretsInText({
      text: result,
      customPatterns: compiledSecretPatterns,
      skipRuleIds: skipSecretRuleIds,
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
 * Does this attribute NAME say the value is an identifier?
 *
 * True for a key that is `id`, or that ends in `_id` or `.id`, in any case.
 * That covers `scenario.run_id`, `langwatch.prompt.id`, `gen_ai.conversation.id`,
 * `metadata.user_id`, `langwatch.gateway_request_id` and every other spelling
 * the ingestion pipeline reads, without a list anyone has to keep current.
 *
 * WHY THE NAME DECIDES. The shape rules ask whether a value looks random. A
 * record id is `prefix_<random body>`, which is exactly as random as a key, so
 * a rule tuned for keys takes ids too, and that is what replaced every
 * `scenario.run_id` with `[SECRET]` at ingestion. The value under an
 * identifier name is an address rather than content: the pipeline compares it
 * to the same value on another record to attach a trace to its run, its
 * prompt, its conversation and its customer. Writing a marker over it hides no
 * credential from anyone and breaks the link for good, because redaction runs
 * at ingestion and the original is never stored.
 *
 * WHAT IT TURNS OFF. Only {@link SHAPE_ONLY_SECRET_RULE_IDS}, the two rules
 * that read a token and nothing else. Every rule that reads a vendor namespace,
 * armour, a URL password, an authorization scheme or a credential keyword still
 * runs, so do the customer's own custom patterns, and so does the whole
 * personal-data pass. A real `sk-ant-…` parked under `scenario.run_id` is still
 * replaced.
 *
 * It also turns off the sensitive-NAME deny-list, because `api_key.id` and
 * `something.token_id` name the identifier OF a credential rather than the
 * credential. The value rules above still read those values by shape and by
 * vendor, so key material pasted under such a name is scrubbed anyway.
 *
 * WHAT IT MUST NOT BECOME. Do not widen this to a namespace, and specifically
 * not to `langwatch.*`: `langwatch.input` and `langwatch.output` are span
 * attributes that carry the chat content itself, so a namespace rule would take
 * the shape rules off the largest customer text in the product. The name has to
 * say "identifier" on its own.
 */
export function isIdentifierAttributeName(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "id" || lower.endsWith("_id") || lower.endsWith(".id");
}

/**
 * Redact one attribute (key + value). When secrets redaction is on and the
 * attribute NAME is obviously sensitive (authorization, api_key, cookie, ...),
 * the whole value is replaced regardless of its shape — the Sentry-style
 * field-name deny-list. Otherwise the value runs through the normal native
 * passes (secrets value-scan + essential PII), marked as an attribute value so
 * the PII pass can hold an identifier-shaped value back from the recognizers
 * that go on shape alone.
 *
 * A name {@link isIdentifierAttributeName} accepts skips both the deny-list and
 * the shape-only value rules. Every other rule runs as it does on any other
 * attribute.
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
  const namesAnIdentifier = isIdentifierAttributeName(key);
  if (
    policy.secrets.enabled &&
    value.length > 0 &&
    !namesAnIdentifier &&
    isSensitiveAttributeKey(key)
  ) {
    return { text: SECRETS_REDACTION_MARKER, redactedCount: 1 };
  }
  return redactStringNative({
    text: value,
    policy,
    skipSecretRuleIds: namesAnIdentifier
      ? SHAPE_ONLY_SECRET_RULE_IDS
      : undefined,
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
