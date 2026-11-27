import {
  type DataPrivacyAudienceOptions,
  type DataPrivacyConfig,
  namedApiKeyIds,
} from "@langwatch/data-privacy-contract";

/** What the picker says about its "API keys" group (ADR-208). */
export const API_KEYS_EXPLAINER =
  "For an agent or script that must read this content. It sees what Admins see.";

/** How the picker names a key a rule still names but that is revoked, expired or gone. */
const API_KEY_GONE_LABEL = "API key no longer live";

/** How the picker names a key the rule names while the key list could not be loaded. */
const API_KEY_UNLOADED_LABEL = "API key whose name could not be loaded";

/** The picker's name for a key the rule names that is not among the live keys. */
export function unlistedApiKeyLabel(options: DataPrivacyAudienceOptions): string {
  return options.apiKeysUnavailable ? API_KEY_UNLOADED_LABEL : API_KEY_GONE_LABEL;
}

/** How the page names a key: its owner's name, that it is gone, or that names did not load. */
export function apiKeyLabel(id: string, options: DataPrivacyAudienceOptions): string {
  const key = options.apiKeys.find((candidate) => candidate.id === id);
  return key ? `API key ${key.name}` : `an ${unlistedApiKeyLabel(options)}`;
}

/** A save that lets a key read restricted content it could not before asks first. */
export function apiKeySaveConfirmation({
  before,
  after,
  options,
}: {
  before: DataPrivacyConfig | undefined;
  after: DataPrivacyConfig;
  options: DataPrivacyAudienceOptions;
}): { title: string; description: string; confirmLabel: string } | null {
  const already = new Set(namedApiKeyIds(before));
  const added = namedApiKeyIds(after).filter((id) => !already.has(id));
  if (added.length === 0) return null;
  const names = added
    .map((id) => options.apiKeys.find((key) => key.id === id)?.name ?? "a key")
    .join(", ");
  return {
    title:
      added.length === 1
        ? "Let an API key read restricted content?"
        : "Let API keys read restricted content?",
    description: `${names} will read the content this rule restricts as Admins do, until the key expires or is revoked, or you remove it from the rule.`,
    confirmLabel: added.length === 1 ? "Save and let it read" : "Save and let them read",
  };
}

type SaveConfirmation = { title: string; description: string; confirmLabel: string };

/** One question for a save that both turns on priced Strict and adds a key, naming both. */
export function combineSaveConfirmations(
  price: SaveConfirmation | null,
  key: SaveConfirmation | null,
): SaveConfirmation | null {
  if (price && key) {
    return { ...key, description: `${price.description} ${key.description}`, confirmLabel: "Save" };
  }
  return price ?? key;
}
