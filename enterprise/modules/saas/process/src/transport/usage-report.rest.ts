// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The daily usage report, at the app host's legacy address every open-source
 * install posts to and at the connect host (`connect.langwatch.ai/v1/stats`).
 * One operation behind both, so the two doors cannot drift.
 */
import { publicRoute } from "@langwatch/api/access";
import {
  callerAddressContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  SaasApi,
  USAGE_REPORT_REQUEST_MAX_BYTES,
  usageReportReceiptSchema,
  usageReportRequestSchema,
} from "@langwatch/enterprise-saas-contract";

const USAGE_REPORT_DOOR = publicRoute({
  reason: "anonymous product telemetry: a self-hosted install presents no credential",
});

export const usageReportRest = defineRestRouter(SaasApi)
  .withNamespace("usage-report")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/track_usage", "receiveUsageReport")
  .keepsRecords()
  .withoutAudit("ingestion")
  .withInput(usageReportRequestSchema)
  .withBodyLimit({ maxBytes: USAGE_REPORT_REQUEST_MAX_BYTES })
  .withAccess(USAGE_REPORT_DOOR)
  .withMiddlewareContext(callerAddressContext)
  .withOutput(usageReportReceiptSchema)
  .withDocs({ hide: true })
  .handle(({ input, app }, callerAddress) =>
    app.receiveUsageReport({ report: input, callerAddress }),
  )

  .post("/api/connect/v1/stats", "receiveConnectUsageReport")
  .keepsRecords()
  .withoutAudit("ingestion")
  .withInput(usageReportRequestSchema)
  .withBodyLimit({ maxBytes: USAGE_REPORT_REQUEST_MAX_BYTES })
  .withAccess(USAGE_REPORT_DOOR)
  .withMiddlewareContext(callerAddressContext)
  .withOutput(usageReportReceiptSchema)
  .withDocs({ hide: true })
  .handle(({ input, app }, callerAddress) =>
    app.receiveUsageReport({ report: input, callerAddress }),
  )
  .build();
