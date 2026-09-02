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
