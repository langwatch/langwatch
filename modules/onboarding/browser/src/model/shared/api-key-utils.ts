/**
 * Masks an API key for display: first 6 and last 4 characters, bullets in
 * between. Returns an empty string when the key is empty/falsy.
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  return `${key.slice(0, 6)}${"•".repeat(4)}${key.slice(-4)}`;
}
