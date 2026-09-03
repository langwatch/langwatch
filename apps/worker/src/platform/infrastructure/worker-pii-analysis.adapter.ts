/**
 * The Google DLP and Presidio clients this process talks to, answering
 * `PiiAnalysisPort`.
 *
 * Harvested from the application's `AppPiiRedactionTransport` and its module
 * functions in `platform/app/src/server/tracer/collector/piiCheck.ts`, which
 * stay as they are while both graphs ingest. It lives here rather than in
 * `@langwatch/data-privacy-server` because it is not the feature's asset: it
 * is two vendor clients, one of which opens a gRPC channel over a generated
 * proto tree, and a feature package that carried them would push that weight
 * into every process that reads a privacy policy.
 *
 * FOUR MECHANICAL DIFFERENCES from the twin, and no others:
 *
 *  - the class extends `PiiAnalysisPort` instead of implementing the
 *    application's `PiiRedactionTransport` interface, and takes its metrics
 *    port alongside its config;
 *  - the three `prom-client` instruments become calls on
 *    `PiiAnalysisMetricsPort`, whose OTel adapter writes the same three series
 *    under the same names with the same labels;
 *  - `PRESIDIO_STRICT_ENTITIES` is imported from `@langwatch/redaction` rather
 *    than declared here, because the custom picker has to read it too;
 *  - the config type is this process's own projection of the same four
 *    environment variables.
 *
 * The two info-type tables, the 250,000-character truncation, the `✳` masking
 * width, the `[REDACTED]` replacement, the `min_threshold` and the request
 * path are pinned by literal in this adapter's test. They are a wire format
 * with a service that answers with anonymized text and no positions: a value
 * this process sends differently is redacted differently, and the response
 * gives no way to notice.
 */

import type { DlpServiceClient } from "@google-cloud/dlp";
import type { google } from "@google-cloud/dlp/build/protos/protos";
import type { BatchEvaluationResult } from "@langwatch/evaluator-contract";
import { type PiiAnalysisMetricsPort, PiiAnalysisPort } from "@langwatch/data-privacy-server";
import { normalizePresidioMarkers, PRESIDIO_STRICT_ENTITIES } from "@langwatch/redaction";
import {
  compilePiiExceptPatterns,
  matchesPiiException,
  type ProtectedRange,
  subtractProtectedRanges,
} from "@langwatch/redaction/pii";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";
import type { WorkerTracePrivacyConfig } from "../config/worker.config";

type DlpClient = DlpServiceClient & { close?: () => Promise<void> };

/**
 * Process-owned Google DLP and Presidio transport. The DLP SDK is kept lazy:
 * no import or gRPC channel is created until a credentialed DLP check runs.
 */
export class WorkerPiiAnalysisAdapter extends PiiAnalysisPort {
  static create(options: {
    config: WorkerTracePrivacyConfig;
    metrics: PiiAnalysisMetricsPort;
  }): WorkerPiiAnalysisAdapter {
    return new WorkerPiiAnalysisAdapter(options.config, options.metrics);
  }

  private dlpClient: Promise<DlpClient> | undefined;

  private constructor(
    private readonly config: WorkerTracePrivacyConfig,
    readonly metrics: PiiAnalysisMetricsPort,
  ) {
    super();
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
  getDlpClient(): Promise<DlpClient> {
    // Assigned before the first await so concurrent callers observe the in-flight
    // promise rather than an unset client.
    this.dlpClient ??= (async () => {
      // Dynamic import (the sanctioned exception to the "no inline import()"
      // rule — same as server.mts / trpc.ts) so the module loads here on first
      // use, never at boot. Only reached after the guards below confirm DLP is
      // enabled and credentialed, so it never loads for deployments that don't
      // use DLP. `import()` rather than `require()` so vitest's module mock
      // intercepts it (a raw require of this externalized dep would not).
      const { DlpServiceClient } = await import("@google-cloud/dlp");
      return new DlpServiceClient({ credentials: this.config.googleDlp.credentials });
    })().catch((error) => {
      // A failed import or constructor must not poison every later check with the
      // same rejected promise — drop it so the next call retries.
      this.dlpClient = undefined;
      throw error;
    });
    return this.dlpClient;
  }

  getConfig(): WorkerTracePrivacyConfig {
    return this.config;
  }

  async tryClearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  }): Promise<string | null> {
    return await clearGoogleDlp(this, input);
  }

  async clearPresidio(
    texts: string[],
    piiRedactionLevel: PIIRedactionLevel,
    entities?: readonly string[],
  ): Promise<(string | null)[]> {
    return await clearPresidio(this.config, this.metrics, texts, piiRedactionLevel, entities);
  }

  async close(): Promise<void> {
    const client = this.dlpClient ? await this.dlpClient : undefined;
    await client?.close?.();
  }
}

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
  transport: WorkerPiiAnalysisAdapter,
  config: WorkerTracePrivacyConfig,
  text: string,
  piiRedactionLevel: PIIRedactionLevel,
): Promise<google.privacy.dlp.v2.IFinding[]> => {
  if (config.googleDlp.disabled) {
    throw new Error(
      "Google DLP redaction requested but it is disabled via LANGWATCH_DISABLE_GOOGLE_DLP. Unset that variable to re-enable DLP, or lower the data-privacy PII level for this scope.",
    );
  }
  const credentials = config.googleDlp.credentials;
  if (!credentials) {
    throw new Error(
      "Google DLP redaction requested but GOOGLE_APPLICATION_CREDENTIALS is not configured. Configure the credentials or lower the data-privacy PII level for this scope.",
    );
  }
  const client = await transport.getDlpClient();
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
    return [{ finding, startIdx: toCodeUnit(+start), endIdx: toCodeUnit(+end) }];
  });

  // First pass: findings whose entire matched text matches a policy exception
  // are known-safe formats (an internal id that merely looks like PII). Their
  // ranges become protected so an overlapping finding cannot eat into them.
  // `includeQuote` is set, but derive the matched text from the range over the
  // ORIGINAL text as the fallback, so the veto never depends on the quote
  // being echoed back.
  const protectedRanges: ProtectedRange[] = ranged.flatMap(({ finding, startIdx, endIdx }) => {
    const matchedText = finding.quote?.length ? finding.quote : text.substring(startIdx, endIdx);
    return matchesPiiException(matchedText, exceptions) ? [{ start: startIdx, end: endIdx }] : [];
  });

  let redacted = text;
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
};

const clearGoogleDlp = async (
  transport: WorkerPiiAnalysisAdapter,
  {
    text: value,
    piiRedactionLevel,
    exceptPatterns,
  }: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  },
): Promise<string | null> => {
  transport.metrics.analysisCalled("google_dlp");
  const [text, remaining] = [value.slice(0, 250_000), value.slice(250_000)];

  const findings = await dlpCheck(transport, transport.getConfig(), text, piiRedactionLevel);
  const { redacted, masked } = maskDlpFindings({
    text,
    findings,
    exceptions: compilePiiExceptPatterns(exceptPatterns ?? []),
  });
  if (masked > 0) {
    return redacted.replace(/✳+/g, "[REDACTED]") + remaining;
  }
  return null;
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
    entities ?? (piiRedactionLevel === "ESSENTIAL" ? essentialInfoTypes : strictInfoTypes).presidio;
  return Object.fromEntries(names.map((name) => [name.toLowerCase(), true]));
}

/**
 * Presidio PII redaction that sends multiple texts in a single batch
 * HTTP request, reducing the number of lambda invocations.
 *
 * @returns Array of anonymized strings (null when text was unchanged).
 */
const clearPresidio = async (
  config: WorkerTracePrivacyConfig,
  metrics: PiiAnalysisMetricsPort,
  texts: string[],
  piiRedactionLevel: PIIRedactionLevel,
  entities?: readonly string[],
): Promise<(string | null)[]> => {
  if (texts.length === 0) return [];

  metrics.analysisCalled("presidio");
  const timeout = config.presidio.timeoutMs;
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
    response = await fetch(`${config.presidio.endpoint}/presidio/pii_detection/evaluate`, {
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
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const duration = performance.now() - startTime;
  metrics.analysisObserved(duration);

  if (!response.ok) {
    metrics.analysisFinished("error");
    throw new Error(await response.text());
  }

  const rawResults = await response.json();
  if (!Array.isArray(rawResults) || rawResults.length !== truncated.length) {
    metrics.analysisFinished("error");
    throw new Error(
      `Unexpected batch response: expected ${truncated.length} results, got ${
        Array.isArray(rawResults) ? rawResults.length : "non-array"
      }`,
    );
  }
  const results = rawResults as BatchEvaluationResult;

  return truncated.map((entry, i) => {
    const result = results[i]!;
    metrics.analysisFinished(result.status);

    if (result.status === "error") {
      throw new Error(result.details);
    }
    if (result.status === "processed" && result.raw_response?.anonymized) {
      return normalizePresidioMarkers(result.raw_response.anonymized) + entry.remaining;
    }
    return null;
  });
};
