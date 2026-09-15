/** The platform's own link for a resource carried by a settled tool result. */
export function extractPlatformUrl(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const value = (output as Record<string, unknown>).platformUrl;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Strip an absolute platform URL to a same-origin relative path. Foreign,
 * relative, malformed and opaque-origin URLs are rejected.
 */
export function toRelativeSameOriginHref({
  url,
  origin,
}: {
  url: string;
  origin: string;
}): string | null {
  if (!origin) return null;
  let parsed: URL;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (originUrl.origin === "null" || parsed.origin === "null") return null;
  if (parsed.origin !== originUrl.origin) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Whether a platform URL identifies a concrete resource, not an index page. */
export function isPreciseResourceHref(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, "http://placeholder.invalid");
  } catch {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments.length > 2 || parsed.search.length > 0;
}
