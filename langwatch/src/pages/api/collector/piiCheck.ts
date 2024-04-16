import type { google } from "@google-cloud/dlp/build/protos/protos";
import { env } from "../../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../../server/tracer/types";
import { getDebugger } from "../../../utils/logger";
import { DlpServiceClient } from "@google-cloud/dlp";

const debug = getDebugger("langwatch:trace_checks:piiCheck");

// Instantiates a client using the environment variable
const credentials = env.GOOGLE_CREDENTIALS_JSON
  ? JSON.parse(env.GOOGLE_CREDENTIALS_JSON)
  : undefined;
const dlp = new DlpServiceClient({ credentials });

const infoTypesMap: Record<string, string> = {
  first_name: "FIRST_NAME",
  last_name: "LAST_NAME",
  person_name: "PERSON_NAME",
  dob: "DATE_OF_BIRTH",
  location: "LOCATION",
  street_address: "STREET_ADDRESS",
  phone_number: "PHONE_NUMBER",
  email_address: "EMAIL_ADDRESS",
  credit_card_number: "CREDIT_CARD_NUMBER",
  iban_code: "IBAN_CODE",
  ip_address: "IP_ADDRESS",
  passport: "PASSPORT",
  vat_number: "VAT_NUMBER",
  medical_record_number: "MEDICAL_RECORD_NUMBER",
};

const allInfoTypes = [
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

const essentialInfoTypes = [
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "CREDIT_CARD_NUMBER",
  "IBAN_CODE",
  "IP_ADDRESS",
  "PASSPORT",
  "VAT_NUMBER",
  "MEDICAL_RECORD_NUMBER",
];

const dlpCheck = async (
  text: string,
  essentialOnly: boolean
): Promise<google.privacy.dlp.v2.IFinding[]> => {
  const [response] = await dlp.inspectContent({
    parent: `projects/${credentials.project_id}/locations/global`,
    inspectConfig: {
      infoTypes: (essentialOnly ? essentialInfoTypes : allInfoTypes).map(
        (name) => ({ name })
      ),
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
  essentialOnly: boolean
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

  const findings = await dlpCheck(currentObject[lastKey], essentialOnly);
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

export const cleanupPIIs = async (
  trace: Trace,
  spans: ElasticSearchSpan[],
  essentialOnly: boolean,
  enforced = true
): Promise<void> => {
  if (!credentials) {
    if (enforced) {
      throw new Error(
        "GOOGLE_CREDENTIALS_JSON is not set, PII check cannot be performed"
      );
    }
    console.warn(
      "WARNING: GOOGLE_CREDENTIALS_JSON is not set, so PII check will not be performed, you are risking storing PII on the database, please set them if you wish to avoid that, this will fail in production by default"
    );
    return;
  }

  debug("Checking PII for trace", trace.trace_id);

  const clearPIIPromises = [
    clearPII(trace, ["input", "value"], essentialOnly),
    clearPII(trace, ["output", "value"], essentialOnly),
    clearPII(trace, ["error", "message"], essentialOnly),
    clearPII(trace, ["error", "stacktrace"], essentialOnly),
  ];

  for (const span of spans) {
    clearPIIPromises.push(clearPII(span, ["input", "value"], essentialOnly));
    clearPIIPromises.push(clearPII(span, ["error", "message"], essentialOnly));

    for (const output of span.outputs) {
      clearPIIPromises.push(clearPII(output, ["value"], essentialOnly));
    }

    for (const context of span.contexts ?? []) {
      if (Array.isArray(context.content)) {
        for (let i = 0; i < context.content.length; i++) {
          clearPIIPromises.push(clearPII(context.content, [i], essentialOnly));
        }
      } else if (typeof context.content === "object") {
        for (const key in context.content) {
          clearPIIPromises.push(
            clearPII(context.content, [key], essentialOnly)
          );
        }
      } else {
        clearPIIPromises.push(clearPII(context, ["content"], essentialOnly));
      }
    }

    for (let i = 0; i < (span.error?.stacktrace ?? []).length; i++) {
      clearPIIPromises.push(
        clearPII(span.error?.stacktrace ?? [], [i], essentialOnly)
      );
    }
  }

  await Promise.all(clearPIIPromises);
};
