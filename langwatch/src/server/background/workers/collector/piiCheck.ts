import { DlpServiceClient } from "@google-cloud/dlp";
import type { google } from "@google-cloud/dlp/build/protos/protos";
import type { PIIRedactionLevel } from "@prisma/client";
import { env } from "../../../../env.mjs";
import { getDebugger } from "../../../../utils/logger";
import type { BatchEvaluationResult } from "../../../evaluations/evaluators.generated";
import type {
  ElasticSearchSpan,
  ElasticSearchTrace,
  Trace,
} from "../../../tracer/types";

const debug = getDebugger("langwatch:trace_checks:piiCheck");

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
  piiRedactionLevel: PIIRedactionLevel,
  mainMethod: "google_dlp" | "presidio"
) => {
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

  if (mainMethod === "presidio") {
    try {
      await presidioClearPII(currentObject, lastKey, piiRedactionLevel);
    } catch (e) {
      if (!credentials || process.env.VITEST_MODE) {
        throw e;
      }
      debug(
        `Error running presidio PII check, running google_dlp as fallback, error: ${
          e as any
        }`
      );
      await googleDLPClearPII(currentObject, lastKey, piiRedactionLevel);
    }
  }

  if (mainMethod === "google_dlp") {
    try {
      await googleDLPClearPII(currentObject, lastKey, piiRedactionLevel);
    } catch (e) {
      if (!process.env.LANGEVALS_ENDPOINT || process.env.VITEST_MODE) {
        throw e;
      }
      debug(
        `Error running google_dlp PII check, running presidio as fallback, error: ${
          e as any
        }`
      );
      await presidioClearPII(currentObject, lastKey, piiRedactionLevel);
    }
  }
};

const googleDLPClearPII = async (
  currentObject: Record<string | number, any>,
  lastKey: string | number,
  piiRedactionLevel: PIIRedactionLevel
): Promise<void> => {
  const findings = await dlpCheck(currentObject[lastKey], piiRedactionLevel);
  for (const finding of findings) {
    const start = finding.location?.codepointRange?.start;
    const end = finding.location?.codepointRange?.end;
    if (start && end) {
      currentObject[lastKey] =
        currentObject[lastKey].substring(0, +start) +
        "✳".repeat(+end - +start) +
        currentObject[lastKey].substring(+end);
    }
  }
  if (findings.length > 0) {
    currentObject[lastKey] = currentObject[lastKey].replace(
      /\✳{1,}/g,
      "[REDACTED]"
    );
  }
};

const presidioClearPII = async (
  currentObject: Record<string | number, any>,
  lastKey: string | number,
  piiRedactionLevel: PIIRedactionLevel
): Promise<void> => {
  const response = await fetch(
    `${env.LANGEVALS_ENDPOINT}/presidio/pii_detection/evaluate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [{ input: currentObject[lastKey] }],
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
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = ((await response.json()) as BatchEvaluationResult)[0];
  if (!result) {
    throw new Error("Unexpected response: empty results");
  }
  if (result.status === "skipped") {
    return;
  }
  if (result.status === "error") {
    throw new Error(result.message);
  }
  if (result.status === "processed" && result.raw_response?.anonymized) {
    currentObject[lastKey] = result.raw_response.anonymized;
  }
};

export const cleanupPIIs = async (
  trace: Trace | ElasticSearchTrace,
  spans: ElasticSearchSpan[],
  piiRedactionLevel: PIIRedactionLevel,
  enforced = true,
  mainMethod: "google_dlp" | "presidio" = "presidio"
): Promise<void> => {
  if (!credentials && mainMethod === "google_dlp") {
    if (enforced) {
      throw new Error(
        "GOOGLE_APPLICATION_CREDENTIALS is not set, PII check cannot be performed"
      );
    }
    console.warn(
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
    console.warn(
      "⚠️  WARNING: LANGEVALS_ENDPOINT is not set, so PII check will not be performed, you are risking storing PII on the database, please set them if you wish to avoid that, this will fail in production by default"
    );
    return;
  }

  debug("Checking PII for trace", trace.trace_id);

  const clearPIIPromises = [
    clearPII(trace, ["input", "value"], piiRedactionLevel, mainMethod),
    clearPII(trace, ["output", "value"], piiRedactionLevel, mainMethod),
    clearPII(trace, ["error", "message"], piiRedactionLevel, mainMethod),
    clearPII(trace, ["error", "stacktrace"], piiRedactionLevel, mainMethod),
  ];

  for (const span of spans) {
    clearPIIPromises.push(
      clearPII(span, ["input", "value"], piiRedactionLevel, mainMethod)
    );
    clearPIIPromises.push(
      clearPII(span, ["error", "message"], piiRedactionLevel, mainMethod)
    );

    if (span.output) {
      clearPIIPromises.push(
        clearPII(span.output, ["value"], piiRedactionLevel, mainMethod)
      );
    }

    for (const context of span.contexts ?? []) {
      if (Array.isArray(context.content)) {
        for (let i = 0; i < context.content.length; i++) {
          clearPIIPromises.push(
            clearPII(context.content, [i], piiRedactionLevel, mainMethod)
          );
        }
      } else if (typeof context.content === "object") {
        for (const key in context.content) {
          clearPIIPromises.push(
            clearPII(context.content, [key], piiRedactionLevel, mainMethod)
          );
        }
      } else {
        clearPIIPromises.push(
          clearPII(context, ["content"], piiRedactionLevel, mainMethod)
        );
      }
    }

    for (let i = 0; i < (span.error?.stacktrace ?? []).length; i++) {
      clearPIIPromises.push(
        clearPII(
          span.error?.stacktrace ?? [],
          [i],
          piiRedactionLevel,
          mainMethod
        )
      );
    }
  }

  await Promise.all(clearPIIPromises);
};
