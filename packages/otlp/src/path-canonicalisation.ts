/**
 * The marker a corrected OTLP request carries; the mapping itself is `canonicalOtlpPath` in
 * @langwatch/observability. See specs/otlp/endpoint-path-canonicalisation.feature.
 */

import { randomUUID } from "node:crypto";

export const OTLP_CORRECTED_PATH_HEADER = "x-langwatch-otlp-corrected-path";

/**
 * A corrected request replays as a new HTTP request, carrying the original
 * path only as a header — which a customer could also send. Prefixed with a
 * per-process secret so the receiver can tell its own replay from a forgery.
 */
const CORRECTION_SECRET = randomUUID();

export function stampCorrectedPath({
  headers,
  originalPath,
}: {
  headers: Headers;
  originalPath: string;
}): void {
  headers.set(OTLP_CORRECTED_PATH_HEADER, `${CORRECTION_SECRET} ${originalPath}`);
}

/** The path the exporter actually used, or null if this was not our replay. */
export function readCorrectedPath(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.indexOf(" ");
  if (separator === -1) return null;
  if (value.slice(0, separator) !== CORRECTION_SECRET) return null;
  return value.slice(separator + 1) || null;
}
