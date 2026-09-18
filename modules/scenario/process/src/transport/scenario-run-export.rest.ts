import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { resolveRequestBound } from "@langwatch/plans";
import { ScenarioApi, scenarioRunExportRequestSchema } from "@langwatch/scenario-contract";

const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

/** The bytes door writes the application-owned gzip stream without buffering a CSV. */
export const scenarioRunExportRest = defineRestRouter(ScenarioApi)
  .withNamespace("scenario-run-export")
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
      filename: download.filename,
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
