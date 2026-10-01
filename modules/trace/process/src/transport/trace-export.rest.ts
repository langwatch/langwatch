import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import { nowInstant } from "@langwatch/time";
import { TraceApi, traceExportRequestSchema } from "@langwatch/trace-contract";

/** Export requests carry filters, not payloads; the bulk cap leaves headroom. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

/** The metadata headers the download producer does not derive for itself. */
function exportHeaders({
  exportId,
  totalCount,
}: {
  exportId: string;
  totalCount: number;
}): Record<string, string> {
  return {
    "X-Export-Id": exportId,
    "X-Total-Traces": String(totalCount),
    "Access-Control-Expose-Headers": "X-Export-Id, X-Total-Traces, Content-Disposition",
  };
}

/** The HTTP bytes door delegates bounded export work to the Trace contract. */
export const traceExportRest = defineRestRouter(TraceApi)
  .withNamespace("export-traces")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("browser")
  .post("/api/export/traces/download", "downloadTraceExport")
  .withInput(traceExportRequestSchema)
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withPermission("traces:view", { at: "route", param: "projectId" })
  .withResponse("bytes", { produces: ["text/csv; charset=utf-8", "application/x-ndjson"] })
  .withDocs({ hide: true })
  .handle(async ({ app, input: request, actor, response }) => {
    const download = await app.downloadTraceExport({ request, userId: actor.id });
    const headers = exportHeaders({
      exportId: download.exportId,
      totalCount: download.totalCount,
    });
    const today = nowInstant().toString().slice(0, 10);
    const extension = request.format === "csv" ? "csv" : "jsonl";

    return response.stream(download.stream, {
      onCancel: download.cancel,
      mediaType: request.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
      filename: `${request.projectId} - Traces - ${today} - ${request.mode}.${extension}`,
      disposition: "attachment",
      headers,
    });
  })
  .build();
