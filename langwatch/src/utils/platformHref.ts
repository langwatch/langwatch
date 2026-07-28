/**
 * Turning a platform-computed `platformUrl` (an ABSOLUTE url, built from
 * `BASE_HOST` + a project-relative path — see
 * `src/app/api/shared/platform-url.ts`) into something safe to hand the SPA
 * router.
 *
 * There is one guard, used from two places with two different notions of
 * "this instance's origin":
 *   - server-side (the Langy relay resolving a navigate instruction), the
 *     origin is `BASE_HOST`;
 *   - client-side (a capability card adopting a CLI result's `platformUrl`),
 *     `BASE_HOST` is not exposed to the browser bundle, so the origin is
 *     `window.location.origin` instead.
 *
 * Either way: a url whose origin does not match is FOREIGN and must never be
 * adopted as an in-app destination — the caller falls back to whatever it
 * would otherwise have built (a rebuilt href, or simply no navigation).
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */

/**
 * The platform's OWN link for a resource, when a CLI result carried one.
 *
 * `output` is a settled tool call's result payload (the same value every
 * capability card already reads its fields from) — a `platformUrl` string on
 * it is server-computed, per resource (see `platformUrl()` /
 * `scenarioRunPlatformUrl()` on the API side), so it is the ONE source of
 * truth for where a resource actually lives; a card's `buildSurfaceHref` is a
 * rebuilt approximation to fall back to only when no such link travelled.
 * Shared by the server relay and the cards — a domain predicate, not a
 * component concern, which is why it lives here and not in the components
 * tree.
 */
export function extractPlatformUrl(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const value = (output as Record<string, unknown>).platformUrl;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Strip `url` to a same-origin relative path (`pathname + search + hash`), or
 * null when `url` does not resolve to `origin` at all — a foreign link
 * (a different host, or plain unparsable input) is never adopted.
 *
 * Opaque origins are rejected on both sides. A URL whose scheme is not
 * http/https (`localhost:3000` with no scheme — which is what a misconfigured
 * `BASE_HOST` looks like, CI included — parses as scheme `localhost:`) has the
 * origin `"null"`, and ANY two such URLs would compare equal. Without this
 * guard a scheme-less origin makes every foreign link "same-origin" and yields
 * a path that isn't even app-absolute. No navigation is the correct answer
 * there, not a guessed one.
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
    // No base: a platformUrl is always absolute, and resolving relative or
    // garbage input against the origin would launder it into "same-origin".
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (originUrl.origin === "null" || parsed.origin === "null") return null;
  if (parsed.origin !== originUrl.origin) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Whether an (already same-origin) platform url addresses a SPECIFIC
 * resource rather than degrading to a surface's bare index page.
 *
 * A generic, resource-agnostic heuristic rather than a per-surface rule: every
 * real per-resource address this platform builds either carries extra path
 * segments beyond `/{projectSlug}/{surface}` (`/datasets/{id}`,
 * `/simulations/{setId}/{batchId}`) or a query string (`?openRun={runId}`,
 * `?drawer.open=…`); a bare index has neither. Used to decide whether a
 * navigate instruction may cache this link as a destination — an index
 * fallback (e.g. a scenario run whose set could not be resolved) must never
 * be treated as "the resource's address" and silently land the user
 * somewhere they didn't ask for.
 */
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
