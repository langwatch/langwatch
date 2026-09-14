import { randomUUID } from "node:crypto";

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
