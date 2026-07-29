import { DlpServiceClient } from "@google-cloud/dlp";
import type { google } from "@google-cloud/dlp/build/protos/protos";
import { createLogger } from "@langwatch/observability";
import type { PIIRedactionLevel } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { env } from "../../../env.mjs";
import { normalizePresidioMarkers } from "../../data-privacy/redaction/markers";
import type { BatchEvaluationResult } from "../../evaluations/evaluators";
import {
  evaluationDurationHistogram,
  getEvaluationStatusCounter,
  getPiiChecksCounter,
} from "../../metrics";

const logger = createLogger("langwatch:tracer:collector:piiCheck");

// Lazy initialization - env vars accessed only when getCredentials() is called
// null = not yet initialized, undefined = initialized but no credentials
let cachedCredentials: { project_id: string } | undefined | null = null;

function getCredentials(): { project_id: string } | undefined {
  if (cachedCredentials === null) {
    if (!env.GOOGLE_APPLICATION_CREDENTIALS) {
      cachedCredentials = undefined;
    } else {
      try {
        const parsed = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS);
        if (
          typeof parsed?.project_id !== "string" ||
          !parsed.project_id.trim()
        ) {
          logger.error(
            "GOOGLE_APPLICATION_CREDENTIALS missing valid project_id",
          );
          cachedCredentials = undefined;
        } else {
          cachedCredentials = parsed;
        }
      } catch (e) {
        logger.error(
          { error: e },
          "Failed to parse GOOGLE_APPLICATION_CREDENTIALS JSON",
        );
        cachedCredentials = undefined;
      }
    }
  }
  return cachedCredentials ?? undefined;
}

// Lazy DLP client - created only when getDlpClient() is called
let dlpClient: DlpServiceClient | undefined;

function getDlpClient(): DlpServiceClient {
  if (!dlpClient) {
    dlpClient = new DlpServiceClient({ credentials: getCredentials() });
  }
  return dlpClient;
}

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

const strictInfoTypes = {
  google_dlp: [
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
  ],
  presidio: [...PRESIDIO_STRICT_ENTITIES],
};

const essentialInfoTypes = {
  google_dlp: [
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "CREDIT_CARD_NUMBER",
    "IBAN_CODE",
    "IP_ADDRESS",
    "PASSPORT",
    "VAT_NUMBER",
    "MEDICAL_RECORD_NUMBER",
  ],
  presidio: [
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
  ],
};

const dlpCheck = async (
  text: string,
  piiRedactionLevel: PIIRedactionLevel,
): Promise<google.privacy.dlp.v2.IFinding[]> => {
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error(
      "Google DLP redaction requested but GOOGLE_APPLICATION_CREDENTIALS is not configured. Configure the credentials or lower the data-privacy PII level for this scope.",
    );
  }
  const [response] = await getDlpClient().inspectContent({
    parent: `projects/${credentials.project_id}/locations/global`,
    inspectConfig: {
      infoTypes: (piiRedactionLevel === "ESSENTIAL"
        ? essentialInfoTypes
        : strictInfoTypes
      ).google_dlp.map((name) => ({ name })),
      minLikelihood: "POSSIBLE",
      limits: {
        maxFindingsPerRequest: 0, // (0 = server maximum)
      },
      // Whether to include the matching string
      includeQuote: true,
    },
    item: {
      value: text,
    },
  });

  return response.result?.findings ?? [];
};

/**
 * Builds a converter from Google DLP codepoint offsets to JS string (UTF-16
 * code unit) indices for `text`. When the text has no surrogate pairs the two
 * indexing schemes coincide, so the identity function is returned.
 */
const codepointToCodeUnitConverter = (text: string): ((cp: number) => number) => {
  if (!/[\uD800-\uDFFF]/.test(text)) {
    return (cp) => cp;
  }
  // offsets[i] = code-unit index of the i-th codepoint (plus a final sentinel
  // at text.length so an end offset past the last codepoint clamps cleanly).
  const offsets: number[] = [];
  let codeUnit = 0;
  for (const char of text) {
    offsets.push(codeUnit);
    codeUnit += char.length;
  }
  offsets.push(codeUnit);
  return (cp) => offsets[Math.max(0, Math.min(cp, offsets.length - 1))]!;
};

export const googleDLPClearPII = async (
  currentObject: Record<string | number, any>,
  lastKey: string | number,
  piiRedactionLevel: PIIRedactionLevel,
): Promise<void> => {
  getPiiChecksCounter("google_dlp").inc();
  const [text, remaining] = [
    currentObject[lastKey].slice(0, 250_000),
    currentObject[lastKey].slice(250_000),
  ];

  const findings = await dlpCheck(text, piiRedactionLevel);
  // DLP reports codepoint offsets against the original text; convert them to
  // code-unit indices once. Each mask below replaces the range with the same
  // number of code units ("✳" is a single BMP code unit), so code-unit indices
  // derived from the original text stay valid on the accumulating copy.
  const toCodeUnit = codepointToCodeUnitConverter(text);
  let redacted = text;
  for (const finding of findings) {
    const start = finding.location?.codepointRange?.start;
    const end = finding.location?.codepointRange?.end;
    if (start != null && end != null) {
      const startIdx = toCodeUnit(+start);
      const endIdx = toCodeUnit(+end);
      redacted =
        redacted.substring(0, startIdx) +
        "✳".repeat(endIdx - startIdx) +
        redacted.substring(endIdx);
    }
  }
  if (findings.length > 0) {
    currentObject[lastKey] = redacted.replace(/✳+/g, "[REDACTED]") + remaining;
  }
};

/**
 * The Presidio `entities` request setting. Uses the explicit override when given
 * (the custom level passes only the analysis-service identifiers a team chose),
 * otherwise the level's default list. Names are lowercased for the analyzer.
 */
function presidioEntitiesSetting(
  piiRedactionLevel: PIIRedactionLevel,
  entities?: readonly string[],
): Record<string, boolean> {
  const names =
    entities ??
    (piiRedactionLevel === "ESSENTIAL" ? essentialInfoTypes : strictInfoTypes)
      .presidio;
  return Object.fromEntries(names.map((name) => [name.toLowerCase(), true]));
}

/**
 * Presidio PII redaction that sends multiple texts in a single batch
 * HTTP request, reducing the number of lambda invocations.
 *
 * @returns Array of anonymized strings (null when text was unchanged).
 */
export const batchPresidioClearPII = async (
  texts: string[],
  piiRedactionLevel: PIIRedactionLevel,
  entities?: readonly string[],
): Promise<(string | null)[]> => {
  if (texts.length === 0) return [];

  getPiiChecksCounter("presidio").inc();
  const timeout = 60_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const startTime = performance.now();

  // Truncate each text to the Presidio limit; track remainders for reassembly.
  const truncated = texts.map((t) => ({
    input: t.slice(0, 250_000),
    remaining: t.slice(250_000),
  }));

  let response: Response;
  try {
    response = await fetch(
      `${env.LANGEVALS_ENDPOINT}/presidio/pii_detection/evaluate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: truncated.map((t) => ({ input: t.input })),
          settings: {
            entities: presidioEntitiesSetting(piiRedactionLevel, entities),
            min_threshold: 0.5,
          },
          env: {},
        }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const duration = performance.now() - startTime;
  evaluationDurationHistogram
    .labels("presidio/pii_detection")
    .observe(duration);

  if (!response.ok) {
    getEvaluationStatusCounter("presidio/pii_detection", "error").inc();
    throw new Error(await response.text());
  }

  const rawResults = await response.json();
  if (!Array.isArray(rawResults) || rawResults.length !== truncated.length) {
    getEvaluationStatusCounter("presidio/pii_detection", "error").inc();
    throw new Error(
      `Unexpected batch response: expected ${truncated.length} results, got ${
        Array.isArray(rawResults) ? rawResults.length : "non-array"
      }`,
    );
  }
  const results = rawResults as BatchEvaluationResult;

  return truncated.map((entry, i) => {
    const result = results[i]!;
    getEvaluationStatusCounter("presidio/pii_detection", result.status).inc();

    if (result.status === "error") {
      throw new Error(result.details);
    }
    if (result.status === "processed" && result.raw_response?.anonymized) {
      return (
        normalizePresidioMarkers(result.raw_response.anonymized) +
        entry.remaining
      );
    }
    return null;
  });
};

export type PIICheckOptions = {
  piiRedactionLevel: PIIRedactionLevel;
  enforced?: boolean;
  mainMethod?: "google_dlp" | "presidio";
  /**
   * Explicit analyzer entity names (uppercase, e.g. "PERSON") to detect,
   * overriding the level's default set. The custom PII level uses this to scan
   * only the analysis-service identifiers a team selected.
   */
  entities?: readonly string[];
};
