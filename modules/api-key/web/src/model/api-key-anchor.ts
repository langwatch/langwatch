/**
 * Where a single API key lives on the Settings > API Keys page.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/pages/settings/api-keys/apiKeyAnchor.ts`,
 * which STAYS: `features/traces-v2/components/TraceDrawer/ApiKeyAttribute.tsx`
 * links a trace's `langwatch.api_key` attribute straight to the row, and the
 * deletes-only ruling forbids repointing that import. Fourteen lines, and both
 * copies are pinned to the same strings by `api-key-anchor.unit.test.ts` — the
 * address is a contract between two families, so a drift in either half breaks a
 * link that reads as a working one.
 *
 * The platform copy dies with the trace family.
 *
 * Spec: specs/traces-v2/api-key-attribute.feature
 */

export const API_KEYS_SETTINGS_PATH = "/settings/api-keys";

/**
 * Anchor id every API key row on Settings > API Keys carries, so surfaces that
 * only know a key by its id (the trace drawer's `langwatch.api_key` attribute)
 * can deep-link straight to its row.
 */
export function apiKeyRowAnchorId(apiKeyId: string): string {
  return `api-key-${apiKeyId}`;
}

export function apiKeySettingsHref(apiKeyId: string): string {
  return `${API_KEYS_SETTINGS_PATH}#${apiKeyRowAnchorId(apiKeyId)}`;
}
