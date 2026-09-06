/**
 * Maps the URLs a misconfigured OpenTelemetry exporter produces onto the
 * canonical OTLP ingestion paths.
 *
 * An exporter builds its own URL: given a base endpoint it appends
 * `/v1/traces`, `/v1/logs` or `/v1/metrics` itself. A customer who puts our
 * signal-specific URL in the base setting therefore posts to
 * `/api/otel/v1/traces/v1/logs`, and one who puts the collector URL there posts
 * to `/api/collector/api/otel/v1/traces`. Both are seen in production, and the
 * customer sees nothing at all — an exporter surfaces a 404 nowhere a human
 * looks, so the telemetry just never arrives.
 *
 * The suffix decides the signal, never the base: the suffix is the part the
 * exporter appended, so it is the part that describes the payload.
 *
 * See specs/otlp/endpoint-path-canonicalisation.feature.
 */

import { randomUUID } from "node:crypto";

export const CANONICAL_OTLP_BASE_PATH = "/api/otel/v1";

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
  const normalised = pathname.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");

  const suffix = SIGNAL_SUFFIX.exec(normalised);
  if (!suffix) return null;

  const prefix = normalised.slice(0, normalised.length - suffix[0].length);
  if (!RECOGNISED_PREFIX.test(prefix)) return null;

  return `${CANONICAL_OTLP_BASE_PATH}/${suffix[1]}`;
}

export const OTLP_CORRECTED_PATH_HEADER = "x-langwatch-otlp-corrected-path";

/**
 * A corrected request is replayed through the canonical route as a new HTTP
 * request, so the original path can only travel with it as a header — and a
 * header is something the customer can send too. The value is prefixed with a
 * per-process secret so the receiver can tell its own replay from a caller
 * claiming one, and never reports a correction that did not happen.
 */
const CORRECTION_SECRET = randomUUID();

export function stampCorrectedPath({
  headers,
  originalPath,
}: {
  headers: Headers;
  originalPath: string;
}): void {
  headers.set(
    OTLP_CORRECTED_PATH_HEADER,
    `${CORRECTION_SECRET} ${originalPath}`,
  );
}

/** The path the exporter actually used, or null if this was not our replay. */
export function readCorrectedPath(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.indexOf(" ");
  if (separator === -1) return null;
  if (value.slice(0, separator) !== CORRECTION_SECRET) return null;
  return value.slice(separator + 1) || null;
}
