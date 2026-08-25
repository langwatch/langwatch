import { PROVENANCE_ATTR_API_KEY_ID } from "@ee/governance/services/ingestKeyProvenance.utils";
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
 * string while the policy stays on, for the reserved attributes in
 * {@link SHAPE_RULE_EXEMPT_ATTRIBUTES}. Custom patterns and the PII pass are
 * out of its reach.
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
 * Attribute names the SHAPE-ONLY secret rules do not run on.
 *
 * These are the names the ingestion pipeline itself reads. It uses them to
 * attach a span to its simulation run, its evaluation run, its prompt, its
 * conversation and the customer it belongs to, and every one of those links is
 * made by comparing the value to the same value on another record. So the value
 * is not free text the customer happens to have sent us, it is an address, and
 * writing `[SECRET]` over it does not hide a credential from anyone. It breaks
 * the link, permanently: redaction runs at ingestion and the original is never
 * stored. Every value in this set is also shown back to the customer as an id,
 * so there is no reader for whom it is content.
 *
 * The set exists because a rule that reads a shape cannot tell a minted id from
 * a minted key, and one that guessed wrong took `scenario.run_id` with it. The
 * shape rules are listed record prefixes now, which is the first line; this is
 * the second, and it holds whatever the shape rules decide next.
 *
 * What it does NOT turn off matters as much, because an exemption that turned
 * the secrets pass off would trade one hole for a worse one: a real key parked
 * under `scenario.run_id` would be stored in the clear. So only
 * {@link SHAPE_ONLY_SECRET_RULE_IDS} is skipped. The sensitive-NAME rule, every
 * rule that reads a vendor namespace, armour, a URL password, an authorization
 * scheme or a credential keyword, the customer's own custom patterns, and the
 * whole PII pass all stay active on these attributes. None of those can match a
 * minted record id, which is a single-underscore `prefix_<base62 body>` with no
 * vendor namespace and no credential word in front of it.
 *
 * Two more limits keep it narrow. It is an exact-name match, so a nested or
 * suffixed variant carries none of it. And a name goes in only when the
 * pipeline reads it: an attribute the product merely stores is content and
 * keeps every rule.
 */
export const SHAPE_RULE_EXEMPT_ATTRIBUTES: ReadonlySet<string> = new Set([
  // Simulation runs. The trace pipeline reads this to send the trace's cost to
  // the run that spent it.
  "scenario.run_id",
  // Evaluation and experiment runs, read the same way.
  "evaluation.run_id",
  // Prompts. The trace fold collects these into the trace's prompt list, which
  // is what shows a prompt its own traces.
  "langwatch.prompt.id",
  "langwatch.prompt.handle",
  "langwatch.prompt.selected.id",
  "langwatch.prompt.version.id",
  "langwatch.prompt.version.number",
  // Conversation, user and customer: the three dimensions traces are grouped
  // and filtered by, each with the spellings the canonicalisers accept.
  "gen_ai.conversation.id",
  "langwatch.thread.id",
  "langwatch.thread_id",
  "langwatch.langgraph.thread_id",
  "metadata.thread_id",
  "langwatch.user.id",
  "langwatch.user_id",
  "metadata.user_id",
  "langwatch.customer.id",
  "langwatch.customer_id",
  "metadata.customer_id",
  // Gateway and ingestion provenance: which virtual key, which request and
  // which ingestion source produced the span. All are row ids written by our
  // own services, and the gateway's key material uses a different prefix.
  "langwatch.virtual_key_id",
  "langwatch.gateway_request_id",
  "langwatch.model_provider_id",
  "langwatch.ingestion_source.id",
  "langwatch.ingestion_source.organization_id",
]);

/**
 * Redact one attribute (key + value). When secrets redaction is on and the
 * attribute NAME is obviously sensitive (authorization, api_key, cookie, ...),
 * the whole value is replaced regardless of its shape — the Sentry-style
 * field-name deny-list, minus {@link NAME_RULE_EXEMPT_ATTRIBUTES}. Otherwise
 * the value runs through the normal native passes (secrets value-scan +
 * essential PII), marked as an attribute value so the PII pass can hold an
 * identifier-shaped value back from the recognizers that go on shape alone.
 *
 * For {@link SHAPE_RULE_EXEMPT_ATTRIBUTES} the shape-only value rules are left
 * out. Every other rule, the name rule included, runs as it does on any other
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
    skipSecretRuleIds: SHAPE_RULE_EXEMPT_ATTRIBUTES.has(key)
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
