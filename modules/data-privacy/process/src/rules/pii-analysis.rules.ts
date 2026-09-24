import { PRESIDIO_STRICT_ENTITIES } from "@langwatch/redaction";
import {
  matchesPiiException,
  type ProtectedRange,
  subtractProtectedRanges,
} from "@langwatch/redaction/pii";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import type { GoogleDlpFinding } from "../channels/google-dlp.channel.ts";

/** How much of one text an analysis service reads; the remainder is carried through untouched. */
export const PII_ANALYSIS_TEXT_BUDGET = 250_000;

const STRICT_GOOGLE_DLP_INFO_TYPES = [
  "FIRST_NAME",
  "LAST_NAME",
  "PERSON_NAME",
  "DATE_OF_BIRTH",
  "LOCATION",
  "STREET_ADDRESS",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "CREDIT_CARD_NUMBER",
  "IBAN_CODE",
  "IP_ADDRESS",
  "PASSPORT",
  "VAT_NUMBER",
  "MEDICAL_RECORD_NUMBER",
];

const ESSENTIAL_GOOGLE_DLP_INFO_TYPES = [
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "CREDIT_CARD_NUMBER",
  "IBAN_CODE",
  "IP_ADDRESS",
  "PASSPORT",
  "VAT_NUMBER",
  "MEDICAL_RECORD_NUMBER",
];

const ESSENTIAL_PRESIDIO_ENTITIES = [
  "CREDIT_CARD",
  "CRYPTO",
  "EMAIL_ADDRESS",
  "IBAN_CODE",
  "IP_ADDRESS",
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
];

export function googleDlpInfoTypesFor(level: PIIRedactionLevel): readonly string[] {
  return level === "ESSENTIAL" ? ESSENTIAL_GOOGLE_DLP_INFO_TYPES : STRICT_GOOGLE_DLP_INFO_TYPES;
}

/** The explicit override when given (a custom level's chosen identifiers), else the level's. */
export function presidioEntitiesFor(
  level: PIIRedactionLevel,
  entities?: readonly string[],
): readonly string[] {
  return (
    entities ?? (level === "ESSENTIAL" ? ESSENTIAL_PRESIDIO_ENTITIES : PRESIDIO_STRICT_ENTITIES)
  );
}

/** DLP counts codepoints; a text without surrogate pairs indexes the same either way. */
function codepointToCodeUnitConverter(text: string): (cp: number) => number {
  if (!/[\uD800-\uDFFF]/.test(text)) return (cp) => cp;
  const offsets: number[] = [];
  let codeUnit = 0;
  for (const char of text) {
    offsets.push(codeUnit);
    codeUnit += char.length;
  }
  offsets.push(codeUnit);
  return (cp) => offsets[Math.max(0, Math.min(cp, offsets.length - 1))] ?? codeUnit;
}

/**
 * Masks every finding with "✳" (one code unit, so indices hold), except where a
 * finding's whole match is a policy exception: that range is protected from
 * every overlapping finding. Main's `maskDlpFindings`, unchanged.
 */
export function maskGoogleDlpFindings(input: {
  text: string;
  findings: readonly GoogleDlpFinding[];
  exceptions: readonly RegExp[];
}): { redacted: string; masked: number } {
  const toCodeUnit = codepointToCodeUnitConverter(input.text);
  const ranged = input.findings.map((finding) => ({
    finding,
    startIdx: toCodeUnit(finding.start),
    endIdx: toCodeUnit(finding.end),
  }));
  const protectedRanges: ProtectedRange[] = ranged.flatMap(({ finding, startIdx, endIdx }) => {
    const matched = finding.quote?.length ? finding.quote : input.text.substring(startIdx, endIdx);
    return matchesPiiException(matched, input.exceptions) ? [{ start: startIdx, end: endIdx }] : [];
  });

  let redacted = input.text;
  let masked = 0;
  for (const { startIdx, endIdx } of ranged) {
    for (const part of subtractProtectedRanges({ start: startIdx, end: endIdx }, protectedRanges)) {
      redacted =
        redacted.substring(0, part.start) +
        "✳".repeat(part.end - part.start) +
        redacted.substring(part.end);
      masked++;
    }
  }
  return { redacted, masked };
}
