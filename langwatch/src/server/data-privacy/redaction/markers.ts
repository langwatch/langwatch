/**
 * Typed redaction markers and the catalog that reads them back.
 *
 * Ingestion-time redaction replaces a matched substring with a marker that
 * names WHAT was removed: a PII entity (`[PHONE_NUMBER]`, `[EMAIL_ADDRESS]`,
 * ...) or `[SECRET]` for a credential. Naming the category, instead of a
 * generic `[REDACTED]`, lets the trace view show what kind of data was scrubbed
 * AND lets the PII / secrets evaluators still flag a leak that was already
 * redacted at the door (otherwise redaction would silently turn every such
 * evaluation green).
 *
 * This module is dependency-free on purpose: the trace-view banner imports it
 * from the client bundle, so it must not pull in the redaction engines or
 * `libphonenumber-js`. The entity set is pinned to the engines by a unit test
 * (see markers.unit.test.ts), mirroring `piiEntityLabels.ts`.
 */

/** The marker written in place of a detected credential. */
export const SECRET_MARKER_ENTITY = "SECRET";
export const SECRET_MARKER = "[SECRET]";

/** Wrap a PII entity name as its redaction marker, e.g. `PHONE_NUMBER` -> `[PHONE_NUMBER]`. */
export function formatPiiMarker(entity: string): string {
  return `[${entity}]`;
}

/**
 * Every entity name a redaction marker can carry: the Presidio strict entity
 * set, the native-only identifiers the analyzer does not have (the Brazilian
 * CPF), and `SECRET`. Used to tell a real marker apart from incidental bracketed
 * text like `[INFO]` or `<div>`. Pinned to the engines by markers.unit.test.ts.
 */
export const REDACTION_MARKER_ENTITIES: ReadonlySet<string> = new Set([
  "CREDIT_CARD",
  "CRYPTO",
  "EMAIL_ADDRESS",
  "IBAN_CODE",
  "IP_ADDRESS",
  "LOCATION",
  "PERSON",
  "PHONE_NUMBER",
  "MEDICAL_LICENSE",
  "US_BANK_NUMBER",
  "US_DRIVER_LICENSE",
  "US_ITIN",
  "US_PASSPORT",
  "US_SSN",
  "UK_NHS",
  "SG_NRIC_FIN",
  "AU_ABN",
  "AU_ACN",
  "AU_TFN",
  "AU_MEDICARE",
  "IN_PAN",
  "IN_AADHAAR",
  "IN_VEHICLE_REGISTRATION",
  "IN_VOTER",
  "IN_PASSPORT",
  "BR_CPF",
  SECRET_MARKER_ENTITY,
]);

// Matches both bracket styles a marker can appear in: `[ENTITY]` (native +
// normalized strict + secrets) and `<ENTITY>` (raw Presidio anonymizer output,
// kept for traces redacted before normalization shipped).
const MARKER_REGEX = /[[<]([A-Z][A-Z0-9_]*)[\]>]/g;

/**
 * Count the redaction markers in a piece of text, grouped by entity. Only
 * markers naming a known entity are counted, so ordinary bracketed log text
 * (`[INFO]`, `<html>`) is ignored. Returns an empty map when there are none.
 */
export function findRedactionMarkers(
  text: string | null | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (typeof text !== "string" || text.length === 0) return counts;
  for (const match of text.matchAll(MARKER_REGEX)) {
    const entity = match[1]!;
    if (!REDACTION_MARKER_ENTITIES.has(entity)) continue;
    counts.set(entity, (counts.get(entity) ?? 0) + 1);
  }
  return counts;
}

/** Whether the text carries any recognized redaction marker. */
export function hasRedactionMarker(text: string | null | undefined): boolean {
  return findRedactionMarkers(text).size > 0;
}

/**
 * Normalize the raw Presidio anonymizer output (`<ENTITY>`) to the bracket
 * marker the rest of the platform uses (`[ENTITY]`), for known entities only so
 * legitimate angle-bracket content is left untouched.
 */
export function normalizePresidioMarkers(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  return text.replace(/<([A-Z][A-Z0-9_]*)>/g, (whole, entity: string) =>
    REDACTION_MARKER_ENTITIES.has(entity) ? `[${entity}]` : whole,
  );
}
