import type { DlpServiceClient } from "@google-cloud/dlp";
import type { google } from "@google-cloud/dlp/build/protos/protos";
import { createLogger } from "@langwatch/observability";
import { normalizePresidioMarkers } from "@langwatch/redaction";
import {
  compilePiiExceptPatterns,
  matchesPiiException,
  type ProtectedRange,
  subtractProtectedRanges,
} from "~/server/data-privacy/redaction/essentialPii";
import type { PIIRedactionLevel } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { env } from "../../../env.mjs";
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

function resolveCredentials(): { project_id: string } | undefined {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) return undefined;
  try {
    const parsed = JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS);
    if (typeof parsed?.project_id !== "string" || !parsed.project_id.trim()) {
      logger.error("GOOGLE_APPLICATION_CREDENTIALS missing valid project_id");
      return undefined;
    }
    return parsed;
  } catch (e) {
    logger.error(
      { error: e },
      "Failed to parse GOOGLE_APPLICATION_CREDENTIALS JSON",
    );
    return undefined;
  }
}

function getCredentials(): { project_id: string } | undefined {
  if (cachedCredentials === null) {
    cachedCredentials = resolveCredentials();
  }
  return cachedCredentials ?? undefined;
}

// Lazy DLP client - created only when getDlpClient() is called. The
// @google-cloud/dlp SDK (generated protos via google-gax/grpc) is one of the
// largest single deps in the server graph, so its module is imported here on
// first use rather than at boot — and only ever when a google_dlp check
// actually runs with credentials configured (see dlpCheck's guards).
//
// The *promise* is what is cached, not the resolved client: the module import
// is asynchronous, so caching only the settled value would let every check that
// arrives while the first import is still in flight construct its own client.
// Each of those holds a gRPC channel, and all but the last would be dropped
// without ever being closed.
let dlpClient: Promise<DlpServiceClient> | undefined;

function getDlpClient(): Promise<DlpServiceClient> {
  // Assigned before the first await so concurrent callers observe the in-flight
  // promise rather than an unset client.
  dlpClient ??= (async () => {
    // Dynamic import (the sanctioned exception to the "no inline import()"
    // rule — same as server.mts / trpc.ts) so the module loads here on first
    // use, never at boot. Only reached after the guards below confirm DLP is
    // enabled and credentialed, so it never loads for deployments that don't
    // use DLP. `import()` rather than `require()` so vitest's module mock
    // intercepts it (a raw require of this externalized dep would not).
    const { DlpServiceClient } = await import("@google-cloud/dlp");
    return new DlpServiceClient({ credentials: getCredentials() });
  })().catch((error) => {
    // A failed import or constructor must not poison every later check with the
    // same rejected promise — drop it so the next call retries.
    dlpClient = undefined;
    throw error;
  });
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
  if (env.LANGWATCH_DISABLE_GOOGLE_DLP) {
    throw new Error(
      "Google DLP redaction requested but it is disabled via LANGWATCH_DISABLE_GOOGLE_DLP. Unset that variable to re-enable DLP, or lower the data-privacy PII level for this scope.",
    );
  }
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error(
      "Google DLP redaction requested but GOOGLE_APPLICATION_CREDENTIALS is not configured. Configure the credentials or lower the data-privacy PII level for this scope.",
    );
  }
  const client = await getDlpClient();
  const [response] = await client.inspectContent({
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
const codepointToCodeUnitConverter = (
  text: string,
): ((cp: number) => number) => {
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

/**
 * Mask every DLP finding over `text`, skipping findings vetoed by a policy
 * exception. DLP reports codepoint offsets against the original text; they are
 * converted to code-unit indices once. Each mask replaces the range with the
 * same number of code units ("✳" is a single BMP code unit), so code-unit
 * indices derived from the original text stay valid on the accumulating copy.
 */
const maskDlpFindings = ({
  text,
  findings,
  exceptions,
}: {
  text: string;
  findings: google.privacy.dlp.v2.IFinding[];
  exceptions: readonly RegExp[];
}): { redacted: string; masked: number } => {
  const toCodeUnit = codepointToCodeUnitConverter(text);
  const ranged = findings.flatMap((finding) => {
    const start = finding.location?.codepointRange?.start;
    const end = finding.location?.codepointRange?.end;
    if (start == null || end == null) return [];
    return [
      { finding, startIdx: toCodeUnit(+start), endIdx: toCodeUnit(+end) },
    ];
  });

  // First pass: findings whose entire matched text matches a policy exception
  // are known-safe formats (an internal id that merely looks like PII). Their
  // ranges become protected so an overlapping finding cannot eat into them.
  // `includeQuote` is set, but derive the matched text from the range over the
  // ORIGINAL text as the fallback, so the veto never depends on the quote
  // being echoed back.
  const protectedRanges: ProtectedRange[] = ranged.flatMap(
    ({ finding, startIdx, endIdx }) => {
      const matchedText = finding.quote?.length
        ? finding.quote
        : text.substring(startIdx, endIdx);
      return matchesPiiException(matchedText, exceptions)
        ? [{ start: startIdx, end: endIdx }]
        : [];
    },
  );

  let redacted = text;
  let masked = 0;
  for (const { startIdx, endIdx } of ranged) {
    for (const part of subtractProtectedRanges(
      { start: startIdx, end: endIdx },
      protectedRanges,
    )) {
      redacted =
        redacted.substring(0, part.start) +
        "✳".repeat(part.end - part.start) +
        redacted.substring(part.end);
      masked++;
    }
  }
  return { redacted, masked };
};

export const googleDLPClearPII = async ({
  currentObject,
  lastKey,
  piiRedactionLevel,
  exceptPatterns,
}: {
  currentObject: Record<string | number, any>;
  lastKey: string | number;
  piiRedactionLevel: PIIRedactionLevel;
  exceptPatterns?: readonly string[];
}): Promise<void> => {
  getPiiChecksCounter("google_dlp").inc();
  const [text, remaining] = [
    currentObject[lastKey].slice(0, 250_000),
    currentObject[lastKey].slice(250_000),
  ];

  const findings = await dlpCheck(text, piiRedactionLevel);
  const { redacted, masked } = maskDlpFindings({
    text,
    findings,
    exceptions: compilePiiExceptPatterns(exceptPatterns ?? []),
  });
  if (masked > 0) {
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
  /**
   * The policy's do-not-redact exception patterns (raw source strings). Only
   * `defaultBatchClearPII`'s google_dlp branch actually reads this: DLP
   * findings carry the matched text, so a finding fully covered by an
   * exception can be vetoed before masking (see maskDlpFindings above).
   * `mainMethod: "presidio"` — the one every strict/custom analysis-service
   * call currently uses — ignores this field entirely: Presidio's batch
   * endpoint returns pre-anonymized text with no positions or matched text to
   * veto against. This is why a resolved policy with exceptions narrows the
   * Presidio call to just the strict-only entities (names, locations) instead
   * of trying to pass exceptions through it (see lambdaAfterNative in
   * span-pii-redaction.service.ts) — narrowing shrinks WHICH entities are
   * exposed to the gap, it does not close it. A name/location match is never
   * protected by an exception; only entities the native pass handles are
   * (locked in by span-pii-redaction.nativeScopedPolicy.test.ts's
   * "strict-only exception scoping" tests).
   */
  exceptPatterns?: readonly string[];
};
