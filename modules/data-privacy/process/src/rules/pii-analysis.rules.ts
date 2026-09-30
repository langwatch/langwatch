import { formatPiiMarker, PRESIDIO_STRICT_ENTITIES } from "@langwatch/redaction";
import {
  matchesPiiException,
  type ProtectedRange,
  subtractProtectedRanges,
} from "@langwatch/redaction/pii";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";
import { z } from "zod";

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

/** What the name/place model finds, and so what it misreads on a model id. */
export const NAME_AND_PLACE_ENTITIES: ReadonlySet<string> = new Set(["PERSON", "LOCATION"]);

/**
 * DLP's counterpart of {@link NAME_AND_PLACE_ENTITIES}. STREET_ADDRESS stays masked on purpose:
 * it needs a street-shaped value, so it does not misfire on a model id.
 */
const DLP_NAME_AND_PLACE_INFO_TYPES: ReadonlySet<string> = new Set([
  "FIRST_NAME",
  "LAST_NAME",
  "PERSON_NAME",
  "LOCATION",
]);

/** Presidio's findings as the analysis service serializes them in `raw_response.results`. */
const presidioFindingsSchema = z.array(
  z.object({
    entity_type: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    score: z.number(),
  }),
);

type PresidioFinding = z.infer<typeof presidioFindingsSchema>[number];

/** A spared redaction: the new text, nothing left to redact, or findings that cannot be placed. */
export type SparedRedaction =
  | { kind: "redacted"; text: string }
  | { kind: "unchanged" }
  | { kind: "unplaceable" };

/**
 * `text` redacted from Presidio's findings, leaving name and place findings out. Findings index
 * the text Presidio analysed (trimmed, JSON escapes unfolded, codepoints), so a text either step
 * would change is unplaceable and the caller keeps Presidio's own full redaction.
 */
export function redactSparingNamesAndPlaces({
  text,
  findings,
}: {
  text: string;
  findings: unknown;
}): SparedRedaction {
  const parsed = presidioFindingsSchema.safeParse(findings);
  if (!parsed.success) return { kind: "unplaceable" };
  if (text !== text.trim() || /[\\\uD800-\uDFFF]/.test(text)) return { kind: "unplaceable" };
  const kept = parsed.data
    .filter((finding) => !NAME_AND_PLACE_ENTITIES.has(finding.entity_type))
    .filter(
      (finding) => finding.start >= 0 && finding.end <= text.length && finding.start < finding.end,
    );
  if (kept.length === 0) return { kind: "unchanged" };

  let redacted = "";
  let cursor = 0;
  for (const { entity_type, start, end } of mergeOverlapping(kept)) {
    redacted += text.substring(cursor, start) + formatPiiMarker(entity_type);
    cursor = end;
  }
  return { kind: "redacted", text: redacted + text.substring(cursor) };
}

/** Overlapping findings merged into one span each, labelled by the higher-scoring finding. */
function mergeOverlapping(findings: readonly PresidioFinding[]): PresidioFinding[] {
  const merged: PresidioFinding[] = [];
  for (const finding of findings.toSorted((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (!last || finding.start >= last.end) {
      merged.push(finding);
      continue;
    }
    merged[merged.length - 1] = {
      ...(finding.score > last.score ? finding : last),
      start: last.start,
      end: Math.max(last.end, finding.end),
    };
  }
  return merged;
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
  /** Leave name and place findings unmasked; they still protect an exception's range first. */
  spareNamesAndPlaces?: boolean;
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
  for (const { finding, startIdx, endIdx } of ranged) {
    if (input.spareNamesAndPlaces && DLP_NAME_AND_PLACE_INFO_TYPES.has(finding.infoType ?? "")) {
      continue;
    }
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
