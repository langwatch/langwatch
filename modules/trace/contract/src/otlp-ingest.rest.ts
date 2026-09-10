/**
 * The OTLP receiver's own errors and small pure helpers. The receiver's ports
 * are declared in the server transport file rather than here: they carry the
 * platform's own `Request`, which - like `TraceExportRestMembers` beside it -
 * keeps this contract free of a DOM-lib dependency neither the browser SDK
 * shape nor another module needs.
 */
import { HandledError } from "@langwatch/handled-error";

/**
 * An ingestion key arrived on a process that resolves no source billing.
 */
export class OtlpIngestSourceBillingUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(sourceType: string) {
    super(
      "service_unavailable",
      "This deployment cannot resolve the billing treatment for an ingestion key's source, so it will not record traffic sent on one.",
      {
        meta: { sourceType },
        httpStatus: 503,
        fault: "platform",
        retryable: true,
      },
    );
    this.name = "OtlpIngestSourceBillingUnavailableError";
  }
}

/**
 * Classifies a token by prefix without exposing the value, so on-call can
 * filter a 401 stream by SDK shape. Ingestion keys are ordinary `sk-lw-`
 * API keys and classify as `legacy` here - the ingest discriminator lives on
 * the resolved row, not the token prefix.
 */
export function classifyTokenType(token: string): "pat" | "legacy" | "unknown" {
  if (token.startsWith("pat-lw-")) return "pat";
  if (token.startsWith("sk-lw-")) return "legacy";
  return "unknown";
}
