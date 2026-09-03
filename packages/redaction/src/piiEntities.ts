/**
 * The PII vocabulary: which identifiers each redaction level covers.
 *
 * DEPENDENCY-FREE ON PURPOSE, and exported from the package root for the same
 * reason `markers.ts` is: the settings screen renders one checkbox per
 * identifier and has to know which side of the split each falls on, and a
 * browser bundle must not pull in `libphonenumber-js` and the recognizer
 * tables to find that out. The engines that USE these lists live behind
 * `@langwatch/redaction/pii`.
 *
 * There used to be a second copy of each list in the application's ingestion
 * path. Both are gone: these are the only declarations, and the consumers
 * import them —
 * `apps/worker/src/platform/infrastructure/worker-pii-analysis.adapter.ts`
 * takes `PRESIDIO_STRICT_ENTITIES` from here rather than restating it, and the
 * strict-only difference is derived in
 * `packages/features/data-privacy/server/src/services/otlp-span-pii-redaction.service.ts`.
 * They stay pinned here by literal all the same: an identifier that quietly
 * leaves a list stops being detected, and a span that was never scanned for it
 * looks exactly like a span that was scanned and found clean.
 */

/** Identifiers the native, in-process engine detects (pattern + checksum based). */
export const ESSENTIAL_PII_ENTITIES = [
  "EMAIL_ADDRESS",
  "IP_ADDRESS",
  "CREDIT_CARD",
  "IBAN_CODE",
  "CRYPTO",
  "PHONE_NUMBER",
  "US_SSN",
  "US_ITIN",
  "US_PASSPORT",
  "US_BANK_NUMBER",
  "US_DRIVER_LICENSE",
  "MEDICAL_LICENSE",
  "UK_NHS",
  "SG_NRIC_FIN",
  "AU_ABN",
  "AU_TFN",
  "IN_PAN",
  "IN_AADHAAR",
  "BR_CPF",
] as const;

/**
 * Entities the Presidio analyzer detects at the strict level. Exported so the
 * settings tooltip's entity labels are test-pinned to this list.
 */
export const PRESIDIO_STRICT_ENTITIES = [
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
] as const;

/**
 * Identifiers the strict analyzer detects that the native engine cannot
 * (names, locations, and a few national IDs). For the custom level these are
 * the only selections that still require the analysis service; everything else
 * is redacted natively.
 */
export const STRICT_ONLY_PII_ENTITIES: readonly string[] = PRESIDIO_STRICT_ENTITIES.filter(
  (entity) => !new Set<string>(ESSENTIAL_PII_ENTITIES).has(entity),
);
