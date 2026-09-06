const CANONICAL_OTLP_BASE_PATH = "/api/otel/v1";

/** The suffix an exporter appends for each signal. */
const SIGNAL_SUFFIX = /\/v1\/(traces|logs|metrics)$/;

/**
 * What a known misconfiguration leaves in front of that suffix, and nothing
 * else. Deliberately an allow-list rather than "any path ending in a signal
 * name": a permissive rule would quietly claim any future namespace that grows
 * a `/v1/traces` of its own.
 *
 *   (empty)                       base endpoint was the site root
 *   /api                          base endpoint was the API root
 *   /api/otel                     the canonical path itself
 *   /api/otel/v1/<signal>         base endpoint was a signal-specific URL
 *   /api/collector[...]           base endpoint was the collector URL
 */
const RECOGNISED_PREFIX =
  /^(?:\/api\/collector)?(?:\/api(?:\/otel(?:\/v1\/(?:traces|logs|metrics))?)?)?$/;

function normalisePathSlashes(pathname: string): string {
  const characters: string[] = [];
  let previousWasSlash = false;

  for (const character of pathname) {
    const isSlash = character === "/";
    if (isSlash && previousWasSlash) {
      continue;
    }

    characters.push(character);
    previousWasSlash = isSlash;
  }

  if (characters.length > 1 && characters.at(-1) === "/") {
    characters.pop();
  }

  return characters.join("");
}

/**
 * The canonical ingestion path this URL is trying to reach, or null when the
 * path is not an OTLP ingestion path at all.
 *
 * Returns the canonical path for an already-canonical input too, so callers
 * decide what "needs correcting" means by comparing against the path they were
 * given — `/api/otel/v1/traces/` differs from the canonical route while
 * normalising to it.
 */
export function canonicalOtlpPath(pathname: string): string | null {
  const normalised = normalisePathSlashes(pathname);

  const suffix = SIGNAL_SUFFIX.exec(normalised);
  if (!suffix) {
    return null;
  }

  const prefix = normalised.slice(0, normalised.length - suffix[0].length);
  if (!RECOGNISED_PREFIX.test(prefix)) {
    return null;
  }

  return `${CANONICAL_OTLP_BASE_PATH}/${suffix[1]}`;
}
