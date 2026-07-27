/**
 * Turns whatever an operator types into the instance base URL.
 *
 * They will type `app.langwatch.ai`, or paste
 * `https://app.langwatch.ai/ops/queues` out of a browser, or type a hostname
 * with a trailing slash. All three mean the same instance, and asking someone to
 * get a scheme right on a phone keyboard is a needless way to fail a sign-in.
 */
export const PRODUCTION_INSTANCE = "https://app.langwatch.ai";

export function parseInstanceUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Default to https. Plain http is still accepted when typed explicitly, for a
  // developer pointing at a local instance.
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;

  // Keep only the origin: a pasted deep link carries a path this app must not
  // treat as an API prefix.
  return url.origin;
}

/** How an instance is written on screen: the host, without the scheme noise. */
export function instanceDisplayName(instance: string): string {
  try {
    return new URL(instance).host;
  } catch {
    return instance;
  }
}
