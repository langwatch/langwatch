/**
 * The NATIVE (in-process) redaction passes for one resolved policy — the
 * only declaration, so every scrubber imports this one. Reads the policy
 * structurally to dodge a `@langwatch/data-privacy-contract` import cycle.
 */

import {
  compilePiiExceptPatterns,
  ESSENTIAL_PII_ENTITIES,
  redactEssentialPiiInText,
} from "./essentialPii.ts";
import { reservesTraceAddress } from "./identifierHoldout.ts";
import {
  compileSecretPatterns,
  isSensitiveAttributeKey,
  redactSecretsInText,
  SECRETS_REDACTION_MARKER,
  SHAPE_ONLY_SECRET_RULE_IDS,
} from "./secrets.ts";

/**
 * The resolved data-privacy policy, as the native passes read it. Structural
 * on purpose: `ResolvedDataPrivacy` from `@langwatch/data-privacy-contract`
 * satisfies this, and so does the app's own copy, without either importing the other.
 */
export type RedactionPolicy = Readonly<{
  pii: Readonly<{
    level: "disabled" | "essential" | "strict" | "custom";
    entities: readonly string[];
    exceptPatterns: readonly string[];
  }>;
  secrets: Readonly<{ enabled: boolean; customPatterns: readonly string[] }>;
}>;

const NATIVE_PII_ENTITY_SET: ReadonlySet<string> = new Set(ESSENTIAL_PII_ENTITIES);

/**
 * Native essential identifiers a resolved policy redacts in-process: `"all"`
 * for essential/strict, the selected subset for custom, `null` when
 * disabled. Names/locations aren't returned — the caller routes those to the analysis service.
 */
export function nativePiiEntitiesForPolicy(policy: RedactionPolicy): "all" | string[] | null {
  switch (policy.pii.level) {
    case "disabled":
      return null;
    case "essential":
    case "strict":
      return "all";
    case "custom":
      return policy.pii.entities.filter((entity) => NATIVE_PII_ENTITY_SET.has(entity));
  }
}

/**
 * Runs secrets then essential PII, the floor even at `strict` — scrubbed
 * here so nothing leaks while the external names/locations service is
 * unreachable. `shouldTreatAsIdentifier` exempts values that joins rely on.
 */
export function redactStringNative({
  text,
  policy,
  compiledSecretPatterns,
  compiledPiiExceptions,
  isAttributeValue = false,
  skipSecretRuleIds,
  shouldTreatAsIdentifier = false,
}: {
  text: string;
  policy: RedactionPolicy;
  compiledSecretPatterns?: readonly RegExp[];
  compiledPiiExceptions?: readonly RegExp[];
  isAttributeValue?: boolean;
  skipSecretRuleIds?: readonly string[];
  shouldTreatAsIdentifier?: boolean;
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
  if (piiEntities !== null && (piiEntities === "all" || piiEntities.length > 0)) {
    const pii = redactEssentialPiiInText({
      text: result,
      entities: piiEntities === "all" ? undefined : piiEntities,
      exceptPatterns: compiledPiiExceptions,
      isAttributeValue,
      shouldTreatAsIdentifier,
    });
    result = pii.text;
    redactedCount += pii.redactedCount;
  }

  return { text: result, redactedCount };
}

/**
 * True for a key that is `id`/ends `_id`/`.id` (any case) — the NAME decides,
 * since a record id is as random as a key and shape rules would redact it.
 * Only turns off {@link SHAPE_ONLY_SECRET_RULE_IDS} and the sensitive-name deny-list.
 */
export function isIdentifierAttributeName(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "id" || lower.endsWith("_id") || lower.endsWith(".id");
}

/** Whether `key` names a secret this policy redacts wholesale, regardless of shape. */
function isSensitiveSecretAttribute({
  policy,
  value,
  namesAnIdentifier,
  key,
}: {
  policy: RedactionPolicy;
  value: string;
  namesAnIdentifier: boolean;
  key: string;
}): boolean {
  if (!policy.secrets.enabled) return false;
  if (value.length === 0) return false;
  if (namesAnIdentifier) return false;
  return isSensitiveAttributeKey(key);
}

/**
 * Redact one attribute. A NAME the deny-list recognizes as sensitive replaces
 * the whole value regardless of shape; otherwise it runs the normal native
 * passes. An identifier-named key ({@link isIdentifierAttributeName}) skips both.
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
  policy: RedactionPolicy;
  compiledSecretPatterns?: readonly RegExp[];
  compiledPiiExceptions?: readonly RegExp[];
}): { text: string; redactedCount: number } {
  const reservesAnAddress = reservesTraceAddress({ key, value });
  const namesAnIdentifier = isIdentifierAttributeName(key);
  if (isSensitiveSecretAttribute({ policy, value, namesAnIdentifier, key })) {
    return { text: SECRETS_REDACTION_MARKER, redactedCount: 1 };
  }
  return redactStringNative({
    text: value,
    policy,
    skipSecretRuleIds: namesAnIdentifier ? SHAPE_ONLY_SECRET_RULE_IDS : undefined,
    shouldTreatAsIdentifier: reservesAnAddress,
    compiledSecretPatterns,
    compiledPiiExceptions,
    isAttributeValue: true,
  });
}

/**
 * Whether the resolved policy still needs the external analysis service after
 * the native passes (only the strict PII level does).
 */
export function needsStrictAnalysis(policy: RedactionPolicy): boolean {
  return policy.pii.level === "strict";
}

/**
 * Compile a resolved policy's custom secret patterns once, for reuse across all
 * of a span's strings.
 */
export function compilePolicySecretPatterns(policy: RedactionPolicy): RegExp[] {
  return compileSecretPatterns(policy.secrets.customPatterns);
}

/**
 * Compile a resolved policy's PII exception patterns once (anchored to full
 * matches), for reuse across all of a span's strings.
 */
export function compilePolicyPiiExceptions(policy: RedactionPolicy): RegExp[] {
  return compilePiiExceptPatterns(policy.pii.exceptPatterns);
}
