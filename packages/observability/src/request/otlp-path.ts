const CANONICAL_OTLP_BASE_PATH = "/api/otel/v1";

/** The suffix an exporter appends for each signal. */
const SIGNAL_SUFFIX = /\/v1\/(traces|logs|metrics)$/;

/**
 * An allow-list of what known misconfigurations leave before the suffix (site root, `/api`,
 * `/api/otel`, `/api/otel/v1/<signal>`, `/api/collector`), so no future namespace with its own
 * `/v1/traces` is claimed. See specs/otlp/endpoint-path-canonicalisation.feature.
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

  if (characters.length > 1 && characters[characters.length - 1] === "/") {
    characters.pop();
  }

  return characters.join("");
}

/**
 * The canonical ingestion path this URL is trying to reach, or null for a non-OTLP path. An
 * already-canonical input answers itself, so callers compare against the path they were given.
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

/** Carries the path a corrected OTLP request was sent to. */
export const OTLP_CORRECTED_PATH_HEADER = "x-langwatch-otlp-corrected-path";

/** A per-process secret prefixes the marker, so a receiver tells our rewrite from a forgery. */
const CORRECTION_SECRET = crypto.randomUUID();

export function stampCorrectedPath({
  headers,
  originalPath,
}: {
  headers: Headers;
  originalPath: string;
}): void {
  headers.set(OTLP_CORRECTED_PATH_HEADER, `${CORRECTION_SECRET} ${originalPath}`);
}

/** The path the exporter actually used, or null if this was not our rewrite. */
export function readCorrectedPath(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.indexOf(" ");
  if (separator === -1) return null;
  if (value.slice(0, separator) !== CORRECTION_SECRET) return null;
  return value.slice(separator + 1) || null;
}
