/**
 * The NATIVE (in-process) redaction passes for one resolved policy — now the
 * only declaration of them, so every scrubbing process imports this one.
 * The policy is read structurally via {@link RedactionPolicy}, not
 * `ResolvedDataPrivacy`, since importing it would close a dependency cycle
 * through `@langwatch/data-privacy-contract`; and nothing here names
 * `PROVENANCE_ATTR_API_KEY_ID`, which would drag in an ingest route.
 */

import {
  compileSecretPatterns,
  isSensitiveAttributeKey,
  redactSecretsInText,
  SECRETS_REDACTION_MARKER,
  SHAPE_ONLY_SECRET_RULE_IDS,
} from "./secrets.ts";
import {
  compilePiiExceptPatterns,
  ESSENTIAL_PII_ENTITIES,
  redactEssentialPiiInText,
} from "./essentialPii.ts";
import { reservesTraceAddress } from "./identifierHoldout.ts";

/**
 * The resolved data-privacy policy, as the native passes read it.
 *
 * Structural on purpose: `ResolvedDataPrivacy` from
 * `@langwatch/data-privacy-contract` satisfies this, and so does the
 * application's own copy, without either package importing the other.
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
 * The native essential identifiers a resolved policy redacts in-process:
 * `"all"` for the essential and strict levels (the full floor), the selected
 * native subset for custom, or `null` when PII is disabled. Identifiers the
 * native engine cannot detect (names, locations) are not returned here; the
 * caller routes those to the analysis service.
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
 * Runs the secrets scrubber then essential PII, which is the floor even at
 * `strict` — scrubbed here before the external service handles names/locations,
 * so nothing leaks while unreachable. `shouldTreatAsIdentifier` marks a value
 * (e.g. a decimal trace id) as an identifier despite its shape, the same
 * exemption a hex id gets, since a reserved name is only a claim the sender
 * made and joins depend on it surviving redaction.
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
 * True for a key that is `id`/ends `_id`/`.id` (any case). The NAME decides,
 * not the value: a record id (`prefix_<random body>`) is as random as a key,
 * so shape rules would otherwise redact it. Only turns off
 * {@link SHAPE_ONLY_SECRET_RULE_IDS} (2 rules) and the sensitive-name
 * deny-list — every other rule and the whole PII pass still run. Deliberately
 * not widened to a namespace: `langwatch.input`/`.output` carry chat content.
 */
export function isIdentifierAttributeName(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "id" || lower.endsWith("_id") || lower.endsWith(".id");
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
