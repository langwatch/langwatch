import { DlpServiceClient } from "@google-cloud/dlp";
import { env } from "../../env.mjs";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type { TraceCheckBackendDefinition, TraceCheckResult } from "../types";
import { getDebugger } from "../../utils/logger";

const debug = getDebugger("langwatch:trace_checks:piiCheck");

// Instantiates a client using the environment variable
const credentials = JSON.parse(env.GOOGLE_CREDENTIALS_JSON);
const dlp = new DlpServiceClient({ credentials });

const execute = async (
  trace: Trace,
  _spans: ElasticSearchSpan[]
): Promise<TraceCheckResult> => {
  debug("Checking PII for trace", trace.id);
  const [response] = await dlp.inspectContent({
    parent: `projects/${credentials.project_id}/locations/global`,
    inspectConfig: {
      infoTypes: [
        // TODO: allow this to be configurable by user
        { name: "PHONE_NUMBER" },
        { name: "EMAIL_ADDRESS" },
        { name: "CREDIT_CARD_NUMBER" },
        { name: "IBAN_CODE" },
        { name: "IP_ADDRESS" },
        { name: "PASSPORT" },
        { name: "VAT_NUMBER" },
        { name: "MEDICAL_RECORD_NUMBER" },
      ],
      minLikelihood: "POSSIBLE",
      limits: {
        maxFindingsPerRequest: 0, // (0 = server maximum)
      },
      // Whether to include the matching string
      includeQuote: true,
    },
    item: {
      value: [trace.input.value, trace.output?.value ?? ""].join("\n\n"),
    },
  });

  const findings = response.result?.findings;

  if (findings && findings.length > 0) {
    for (const finding of findings) {
      finding.quote = "READACTED"; // prevent storing quote in ES
    }

    return {
      raw_result: {
        findings,
      },
      value: findings.length,
      status: "failed",
    };
  }

  return {
    raw_result: {
      findings: [],
    },
    value: 0,
    status: "succeeded",
  };
};

export const PIICheck: TraceCheckBackendDefinition = {
  execute,
};
