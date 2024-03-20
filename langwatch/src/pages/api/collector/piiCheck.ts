import { DlpServiceClient } from "@google-cloud/dlp";
import { env } from "../../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../../server/tracer/types";
import { getDebugger } from "../../../utils/logger";
import type { google } from "@google-cloud/dlp/build/protos/protos";
import type { Evaluators } from "../../../trace_checks/evaluators.generated";

const debug = getDebugger("langwatch:trace_checks:piiCheck");

// Instantiates a client using the environment variable
const credentials = env.GOOGLE_CREDENTIALS_JSON
  ? JSON.parse(env.GOOGLE_CREDENTIALS_JSON)
  : undefined;
const dlp = new DlpServiceClient({ credentials });

const infoTypesMap: Record<
  keyof Evaluators["google_cloud/dlp_pii_detection"]["settings"]["info_types"],
  string
> = {
  phone_number: "PHONE_NUMBER",
  email_address: "EMAIL_ADDRESS",
  credit_card_number: "CREDIT_CARD_NUMBER",
  iban_code: "IBAN_CODE",
  ip_address: "IP_ADDRESS",
  passport: "PASSPORT",
  vat_number: "VAT_NUMBER",
  medical_record_number: "MEDICAL_RECORD_NUMBER",
};

const dlpCheck = async (
  text: string
): Promise<google.privacy.dlp.v2.IFinding[] | null | undefined> => {
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

  return response.result?.findings;
};

export const runPiiCheck = async (
  trace: Trace,
  spans: ElasticSearchSpan[],
  enforced = true
): Promise<{
  quotes: string[];
  traceFindings: google.privacy.dlp.v2.IFinding[];
  spansFindings: google.privacy.dlp.v2.IFinding[];
}> => {
  if (!credentials) {
    if (enforced) {
      throw new Error(
        "GOOGLE_CREDENTIALS_JSON is not set, PII check cannot be performed"
      );
    }
    console.warn(
      "WARNING: GOOGLE_CREDENTIALS_JSON is not set, so PII check will not be performed, you are risking storing PII on the database, please set GOOGLE_CREDENTIALS_JSON if you wish to avoid that, this will fail in production by default"
    );
    return {
      quotes: [],
      traceFindings: [],
      spansFindings: [],
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
        .concat(span.error?.stacktrace ?? [])
    )
    .join("\n\n");

  const traceFindings = (await dlpCheck(traceText)) ?? [];
  const spansFindings = (spansText ? await dlpCheck(spansText) : []) ?? [];
  const allFindings = traceFindings.concat(spansFindings);

  const quotes = allFindings.map((finding) => finding.quote!).filter((x) => x);
  for (const finding of allFindings) {
    finding.quote = "REDACTED"; // prevent storing quote in ES
  }

  return {
    quotes,
    traceFindings,
    spansFindings,
  };
};
