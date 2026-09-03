import { describe, expect, it } from "vitest";

import {
  ESSENTIAL_PII_ENTITIES,
  PRESIDIO_STRICT_ENTITIES,
  STRICT_ONLY_PII_ENTITIES,
} from "../piiEntities.js";
import { REDACTION_MARKER_ENTITIES, SECRET_MARKER_ENTITY } from "../markers.js";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * These are LITERAL pins, not reads of the application's source.
 *
 * Two graphs redact the same tenants' spans while the trace conversion is in
 * flight, and these lists decide what each of them looks for. Nothing in a
 * stored span records which identifiers were searched: a span scanned for
 * nineteen identifiers and a span scanned for eighteen are the same row, and
 * the missing one is personal data left in ClickHouse. A test that read the
 * application's file would agree with it by construction and would also die
 * the moment either file moves.
 */
describe("given the identifiers the native engine covers", () => {
  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("is exactly the application's essential list, in its order", () => {
    expect([...ESSENTIAL_PII_ENTITIES]).toEqual([
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
    ]);
  });
});

describe("given the identifiers the strict analyzer covers", () => {
  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("is exactly the application's Presidio list, in its order", () => {
    expect([...PRESIDIO_STRICT_ENTITIES]).toEqual([
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
    ]);
  });
});

describe("given the split between the native floor and the analysis service", () => {
  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("sends only the identifiers the native engine cannot detect out of process", () => {
    expect([...STRICT_ONLY_PII_ENTITIES]).toEqual([
      "LOCATION",
      "PERSON",
      "AU_ACN",
      "AU_MEDICARE",
      "IN_VEHICLE_REGISTRATION",
      "IN_VOTER",
      "IN_PASSPORT",
    ]);
  });

  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("keeps the two sides disjoint, so no identifier is scanned twice", () => {
    const essential = new Set<string>(ESSENTIAL_PII_ENTITIES);
    expect(STRICT_ONLY_PII_ENTITIES.filter((entity) => essential.has(entity))).toEqual([]);
  });

  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("covers the whole strict list between the two sides", () => {
    const essential = new Set<string>(ESSENTIAL_PII_ENTITIES);
    const covered = new Set<string>([
      ...PRESIDIO_STRICT_ENTITIES.filter((entity) => essential.has(entity)),
      ...STRICT_ONLY_PII_ENTITIES,
    ]);
    expect([...covered].sort()).toEqual([...PRESIDIO_STRICT_ENTITIES].sort());
  });
});

describe("given a redaction marker naming an identifier", () => {
  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("can name every identifier either engine detects", () => {
    const detectable = new Set<string>([...ESSENTIAL_PII_ENTITIES, ...PRESIDIO_STRICT_ENTITIES]);
    for (const entity of detectable) {
      expect(REDACTION_MARKER_ENTITIES.has(entity)).toBe(true);
    }
  });

  /** @scenario "The two identifier lists say the same thing in both processes" */
  it("names nothing the engines cannot produce, apart from the secrets marker", () => {
    const detectable = new Set<string>([...ESSENTIAL_PII_ENTITIES, ...PRESIDIO_STRICT_ENTITIES]);
    const unexplained = [...REDACTION_MARKER_ENTITIES].filter(
      (entity) => entity !== SECRET_MARKER_ENTITY && !detectable.has(entity),
    );
    expect(unexplained).toEqual([]);
  });

  /** @scenario "The settings picker offers each identifier under the level that detects it" */
  it("keeps the Brazilian CPF as the one native-only identifier", () => {
    const analyzer = new Set<string>(PRESIDIO_STRICT_ENTITIES);
    expect(ESSENTIAL_PII_ENTITIES.filter((entity) => !analyzer.has(entity))).toEqual(["BR_CPF"]);
  });
});
