/**
 * The OTLP receiver's own errors and small pure helpers. Ports live in the
 * server transport file instead, keeping this contract free of the DOM-lib
 * `Request` dependency neither the browser SDK nor another module needs.
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
 * Classifies a token by prefix without exposing the value. `sk-lw-` keys
 * classify as `legacy` — the ingest discriminator lives on the resolved row,
 * not the token prefix.
 */
export function classifyTokenType(token: string): "pat" | "legacy" | "unknown" {
  if (token.startsWith("pat-lw-")) return "pat";
  if (token.startsWith("sk-lw-")) return "legacy";
  return "unknown";
}
