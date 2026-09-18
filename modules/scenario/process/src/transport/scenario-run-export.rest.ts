import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  ScenarioApi,
  scenarioRunExportRequestSchema,
  type ScenarioRunExportRequest,
} from "@langwatch/scenario-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { format, nowInstant } from "@langwatch/time";

const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

function downloadFilename(request: ScenarioRunExportRequest): string {
  const today = format(nowInstant().epochMilliseconds, "yyyy-MM-dd", { timeZone: "UTC" });
  const projectId = request.projectId.replace(/[^\w.-]/g, "_");

  return `${projectId} - Scenario Runs - ${today} - ${request.mode}.csv`;
}

/** The bytes door writes the application-owned gzip stream without buffering a CSV. */
export const scenarioRunExportRest = defineRestRouter(ScenarioApi)
  .withNamespace("export/scenario-runs")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("browser")
  .post("/api/export/scenario-runs/download", "downloadScenarioRunExport")
  .withInput(scenarioRunExportRequestSchema)
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withPermission("scenarios:view", { at: "route", param: "projectId" })
  .withResponse("bytes", { produces: "text/csv; charset=utf-8" })
  .withDocs({ description: "Stream a project's simulation run history as gzipped CSV" })
  .handle(async ({ app, input: request, actor, signal, response }) => {
    const download = await app.downloadScenarioRunExport({
      request,
      userId: actor.id,
      signal,
    });

    return response.stream(download.stream, {
      mediaType: "text/csv; charset=utf-8",
      filename: downloadFilename(request),
      disposition: "attachment",
      onCancel: download.cancel,
      headers: {
        "Content-Encoding": "gzip",
        Vary: "Accept-Encoding",
        "X-Export-Id": download.exportId,
        "X-Total-Runs": String(download.totalCount),
        "Access-Control-Expose-Headers": "X-Export-Id, X-Total-Runs, Content-Disposition",
      },
    });
  })
  .build();
