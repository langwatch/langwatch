/**
 * ADR-208: which API keys a privacy rule's audience may name. A named key reads that rule's
 * restricted content as Admins do, so only a live key a customer made is ever offered or saved.
 */
import { type ApiKey, isSystemApiKey } from "@langwatch/api-key-contract";
import { CONTENT_CATEGORIES, type DataPrivacyConfig } from "@langwatch/data-privacy-contract";
import { type Instant, toEpochMs } from "@langwatch/time";

/**
 * A live service key a customer made: not expired, minted by LangWatch, an ingest key or a
 * session's. A personal key never reads more than its person, so a rule never names one.
 */
function isNameable(key: ApiKey, now: Instant): boolean {
  return (
    key.userId === null &&
    key.revokedAt === null &&
    (key.expiresAt === null || toEpochMs(key.expiresAt) > now.epochMilliseconds) &&
    !isSystemApiKey(key) &&
    key.ingestSourceType === null &&
    !key.createdByBrowserSessionId &&
    !key.parentApiKeyId
  );
}

/** The keys the audience picker offers, by the names their owners gave them, sorted by name. */
export function offerableApiKeys(input: {
  keys: readonly ApiKey[];
  now: Instant;
}): { id: string; name: string }[] {
  return input.keys
    .filter((key) => isNameable(key, input.now))
    .map((key) => ({ id: key.id, name: key.name }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * The named keys a save must refuse: not the organization's, or not a customer's live key.
 * A key the stored rule already named stays, so revoking a key never blocks editing its rule.
 */
export function foreignApiKeyIds(input: {
  named: readonly string[];
  keys: readonly ApiKey[];
  kept: readonly string[];
  now: Instant;
}): string[] {
  const nameable = new Set(
    input.keys.filter((key) => isNameable(key, input.now)).map((key) => key.id),
  );
  return input.named.filter((id) => !nameable.has(id) && !input.kept.includes(id));
}

/** Whether a captured or dropped category names keys: only restricted content has an audience. */
export function namesKeysOnUnrestrictedCategory(config: DataPrivacyConfig): boolean {
  return CONTENT_CATEGORIES.some((category) => {
    const setting = config.categories?.[category];
    return setting?.disposition !== "restrict" && (setting?.audience?.apiKeyIds?.length ?? 0) > 0;
  });
}

/** Whether a category names keys in an audience Admins are not in: a key reads as Admins do. */
export function namesKeysWithoutAdmins(config: DataPrivacyConfig): boolean {
  return CONTENT_CATEGORIES.some((category) => {
    const audience = config.categories?.[category]?.audience;
    return (audience?.apiKeyIds?.length ?? 0) > 0 && !audience?.admins && !audience?.allMembers;
  });
}

/**
 * Whether the restricted categories name different keys. The drawer edits one audience for
 * every restricted category, so a later save would silently add or drop a key on some of them.
 */
export function restrictedCategoriesDisagreeOnKeys(config: DataPrivacyConfig): boolean {
  const keySets = CONTENT_CATEGORIES.flatMap((category) => {
    const setting = config.categories?.[category];
    if (setting?.disposition !== "restrict") return [];
    return [[...new Set(setting.audience?.apiKeyIds ?? [])].toSorted().join(",")];
  });
  return new Set(keySets).size > 1;
}
