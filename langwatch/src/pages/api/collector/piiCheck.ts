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

const dlpCheck = async (text: string): Promise<string[]> => {
  const [response] = await dlp.inspectContent({
    parent: `projects/${credentials.project_id}/locations/global`,
    inspectConfig: {
      infoTypes: Object.values(infoTypesMap).map((name) => ({ name })),
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

  return (
    response.result?.findings?.flatMap((x) => (x.quote ? [x.quote] : [])) ?? []
  );
};

export const runPiiCheck = async (
  trace: Trace,
  spans: ElasticSearchSpan[],
  enforced = true
): Promise<{
  quotes: string[];
}> => {
  if (!credentials) {
    if (enforced) {
      throw new Error(
        "GOOGLE_CREDENTIALS_JSON is not set, PII check cannot be performed"
      );
    }
    console.warn(
      "WARNING: GOOGLE_CREDENTIALS_JSON is not set, so PII check will not be performed, you are risking storing PII on the database, please set them if you wish to avoid that, this will fail in production by default"
    );
    return {
      quotes: [],
    };
  }

  debug("Checking PII for trace", trace.trace_id);

  const traceText = [
    trace.input.value,
    trace.output?.value ?? "",
    trace.error?.message ?? "",
    trace.error?.stacktrace ?? "",
  ].join("\n\n");
  const spansText = spans
    .flatMap((span) =>
      [span.input?.value ?? "", span.error?.message ?? ""]
        .concat(span.outputs.map((x) => x.value))
        .concat(
          (span.contexts ?? []).flatMap((x) => {
            if (Array.isArray(x)) {
              return x;
            }

            if (typeof x.content === "object") {
              return Object.entries(x.content);
            }

            return [x.content];
          })
        )
        .concat(span.error?.stacktrace ?? [])
    )
    .join("\n\n");

  const traceQuotes = (await dlpCheck(traceText)) ?? [];
  const spansQuotes = (spansText ? await dlpCheck(spansText) : []) ?? [];

  return {
    quotes: traceQuotes.concat(spansQuotes),
  };
};
