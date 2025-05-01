import { DlpServiceClient } from "@google-cloud/dlp";
import type { google } from "@google-cloud/dlp/build/protos/protos";
import type { PIIRedactionLevel } from "@prisma/client";
import { env } from "../../../../env.mjs";
import type { BatchEvaluationResult } from "../../../evaluations/evaluators.generated";
import type {
  ElasticSearchSpan,
  ElasticSearchTrace,
  Trace,
} from "../../../tracer/types";
import {
  evaluationDurationHistogram,
  getEvaluationStatusCounter,
  getPiiChecksCounter,
} from "../../../metrics";
import * as Sentry from "@sentry/nextjs";
import { createLogger } from "../../../../utils/logger";

const logger = createLogger("langwatch:workers:collector:piiCheck");

// Instantiates a client using the environment variable
const credentials = env.GOOGLE_APPLICATION_CREDENTIALS
  ? JSON.parse(env.GOOGLE_APPLICATION_CREDENTIALS)
  : undefined;
const dlp = new DlpServiceClient({ credentials });

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
  presidio: [
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
  ],
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
  piiRedactionLevel: PIIRedactionLevel
): Promise<google.privacy.dlp.v2.IFinding[]> => {
  const [response] = await dlp.inspectContent({
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

const clearPII = async (
  object: Record<string | number, any>,
  keysPath: (string | number)[],
  options: PIICheckOptions
) => {
  const { piiRedactionLevel, mainMethod, enforced } = options;

  const lastKey = keysPath[keysPath.length - 1];
  if (!lastKey) {
    return;
  }

  let currentObject = object;
  for (const key of keysPath.slice(0, -1)) {
    currentObject = currentObject[key];
    if (!currentObject) {
      return;
    }
  }

  if (!currentObject[lastKey] || typeof currentObject[lastKey] !== "string") {
    return;
  }

  const methods = {
    presidio: presidioClearPII,
    google_dlp: googleDLPClearPII,
  };
  const firstMethod = mainMethod ?? "presidio";
  const secondMethod = firstMethod === "google_dlp" ? "presidio" : "google_dlp";

  try {
    await methods[firstMethod](currentObject, lastKey, piiRedactionLevel);
  } catch (e) {
    if (
      secondMethod === "google_dlp"
        ? !credentials
        : !process.env.LANGEVALS_ENDPOINT
    ) {
      if (enforced) {
        throw e;
      } else {
        logger.warn(
          "⚠️  WARNING: Fail to redact PII with error but allowed to continue, this will fail in production by default."
        );
        return;
      }
    }
    logger.debug(
      { error: e as any },
      `error running ${firstMethod} PII check, running ${secondMethod} as fallback`
    );

    try {
      await methods[secondMethod](currentObject, lastKey, piiRedactionLevel);
    } catch (e) {
      if (enforced) {
        throw e;
      }
      logger.warn(
        "⚠️  WARNING: Fail to redact PII with error but allowed to continue, this will fail in production by default."
      );
    }
  }
};

const googleDLPClearPII = async (
  currentObject: Record<string | number, any>,
  lastKey: string | number,
  piiRedactionLevel: PIIRedactionLevel
): Promise<void> => {
  getPiiChecksCounter("google_dlp").inc();
  const [text, remaining] = [
    currentObject[lastKey].slice(0, 250_000),
    currentObject[lastKey].slice(250_000),
  ];

  const findings = await dlpCheck(text, piiRedactionLevel);
  for (const finding of findings) {
    const start = finding.location?.codepointRange?.start;
    const end = finding.location?.codepointRange?.end;
    if (start && end) {
      currentObject[lastKey] =
        text.substring(0, +start) +
        "✳".repeat(+end - +start) +
        text.substring(+end);
    }
  }
  if (findings.length > 0) {
    currentObject[lastKey] = text.replace(/\✳{1,}/g, "[REDACTED]") + remaining;
  }
};

const presidioClearPII = async (
  currentObject: Record<string | number, any>,
  lastKey: string | number,
  piiRedactionLevel: PIIRedactionLevel
): Promise<void> => {
  getPiiChecksCounter("presidio").inc();
  const timeout = 60_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const startTime = performance.now();

  const [text, remaining] = [
    currentObject[lastKey].slice(0, 250_000),
    currentObject[lastKey].slice(250_000),
  ];

  const response = await fetch(
    `${env.LANGEVALS_ENDPOINT}/presidio/pii_detection/evaluate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [{ input: text }],
        settings: {
          entities: Object.fromEntries(
            (piiRedactionLevel === "ESSENTIAL"
              ? essentialInfoTypes
              : strictInfoTypes
            ).presidio.map((name) => [name.toLowerCase(), true])
          ),
          min_threshold: 0.5,
        },
        env: {},
      }),
      signal: controller.signal,
    }
  );

  clearTimeout(timeoutId);

  const duration = performance.now() - startTime;
  evaluationDurationHistogram
    .labels("presidio/pii_detection")
    .observe(duration);

  if (!response.ok) {
    getEvaluationStatusCounter("presidio/pii_detection", "error").inc();
    throw new Error(await response.text());
  }

  const result = ((await response.json()) as BatchEvaluationResult)[0];
  if (!result) {
    getEvaluationStatusCounter("presidio/pii_detection", "error").inc();
    throw new Error("Unexpected response: empty results");
  }
  getEvaluationStatusCounter("presidio/pii_detection", result.status).inc();
  if (result.status === "skipped") {
    return;
  }
  if (result.status === "error") {
    throw new Error(result.details);
  }
  if (result.status === "processed" && result.raw_response?.anonymized) {
    currentObject[lastKey] = result.raw_response.anonymized + remaining;
  }
};

type PIICheckOptions = {
  piiRedactionLevel: PIIRedactionLevel;
  enforced?: boolean;
  mainMethod?: "google_dlp" | "presidio";
};

export const cleanupPIIs = async (
  trace: Trace | Omit<ElasticSearchTrace, "spans">,
  spans: ElasticSearchSpan[],
  options: PIICheckOptions
): Promise<void> => {
  return await Sentry.startSpan({ name: "cleanupPIIs" }, async () => {
    const { enforced, mainMethod } = options;

    if (!credentials && mainMethod === "google_dlp") {
      if (enforced) {
        throw new Error(
          "GOOGLE_APPLICATION_CREDENTIALS is not set, PII check cannot be performed"
        );
      }
      logger.warn(
        "⚠️  WARNING: GOOGLE_APPLICATION_CREDENTIALS is not set, so PII check will not be performed, you are risking storing PII on the database, please set them if you wish to avoid that, this will fail in production by default"
      );
      return;
    }
    if (mainMethod === "presidio" && !process.env.LANGEVALS_ENDPOINT) {
      if (enforced) {
        throw new Error(
          "LANGEVALS_ENDPOINT is not set, PII check cannot be performed"
        );
      }
      logger.warn(
        "⚠️  WARNING: LANGEVALS_ENDPOINT is not set, so PII check will not be performed, you are risking storing PII on the database, please set them if you wish to avoid that, this will fail in production by default"
      );
      return;
    }

    logger.debug({ traceId: trace.trace_id }, "checking PII for trace");

    const clearPIIPromises = [
      clearPII(trace, ["input", "value"], options),
      clearPII(trace, ["output", "value"], options),
      clearPII(trace, ["error", "message"], options),
    ];

    for (const span of spans) {
      clearPIIPromises.push(clearPII(span, ["input", "value"], options));
      clearPIIPromises.push(clearPII(span, ["error", "message"], options));

      if (span.output) {
        clearPIIPromises.push(clearPII(span.output, ["value"], options));
      }

      for (const context of span.contexts ?? []) {
        if (Array.isArray(context.content)) {
          for (let i = 0; i < context.content.length; i++) {
            clearPIIPromises.push(clearPII(context.content, [i], options));
          }
        } else if (typeof context.content === "object") {
          for (const key in context.content) {
            clearPIIPromises.push(clearPII(context.content, [key], options));
          }
        } else {
          clearPIIPromises.push(clearPII(context, ["content"], options));
        }
      }
    }

    await Promise.all(clearPIIPromises);
  });
};
