// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/governance/ocsf`: the organisation's OCSF 1.9.0 export streams, read with an organisation
 * API key holding `complianceExport:view`, and the push-in of OCSF events from other sources with
 * `governance:manage`, on an Enterprise plan. Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
import {
  canonicalBaseResponses,
  canonicalUnprocessableResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  GovernanceRestApi,
  ocsfAuditQuerySchema,
  ocsfEventsPageSchema,
  ocsfEventsQuerySchema,
  ocsfIngestRequestSchema,
  ocsfIngestResponseSchema,
  ocsfTracesQuerySchema,
  securityLakeConnectionTestInputSchema,
  securityLakeConnectionTestSchema,
  securityLakeSourceCreateInputSchema,
  securityLakeSourceHealthSchema,
  securityLakeSourceSchema,
  securityLakeSourceUpdateInputSchema,
} from "@langwatch/enterprise-governance-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { z } from "zod";

const TAGS = ["Governance / OCSF SIEM"];
const LAKE_TAGS = ["Governance / Security Lake"];
const sourceParams = z.object({ sourceId: z.string().min(1) });
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");
const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const PAGING =
  "Pass `next_cursor` back as `cursor` to read on; it is always set, so a puller stores it between runs. `has_more` is true when more events are already waiting. `since` (ISO 8601 with an offset, 1970-01-01T00:00:00Z or later) starts the first read and a cursor carries its own position. `until` (same format and lower bound) is not in the cursor: send it with every page.";

export const ocsfSiemRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("governance-ocsf")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // The prefix is shared with `/api/governance`, so each route names its whole path.
  .withAddressing("literal", { v1Twin: true })

  .get("/api/governance/ocsf/events", "listOcsfEvents")
  .withQuery(ocsfEventsQuerySchema)
  .withPermission("complianceExport:view")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(ocsfEventsPageSchema)
  .withDocs({
    operationId: "getApiGovernanceOcsfEvents",
    summary: "Export governance events as OCSF 1.9.0",
    tags: TAGS,
    description: `The organisation's governance events as OCSF 1.9.0 API Activity (6003) events, oldest first: traces from ingestion sources, events pulled from provider audit APIs, admin workspace views and OCSF events pushed in from other sources (\`source_type\` \`ocsf_push\`, returned as received). Each LangWatch event carries \`ai_model\`, \`ai_agent\` and \`message_context\` token counts when known, and the cost under \`unmapped.langwatch\`. Filter with \`source_type\` and \`source_id\`. ${PAGING}`,
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listOcsfEvents({
      organizationId: scope.id,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.since ? { since: input.since } : {}),
      ...(input.until ? { until: input.until } : {}),
      ...(input.source_type ? { sourceType: input.source_type } : {}),
      ...(input.source_id ? { sourceId: input.source_id } : {}),
    }),
  )

  .get("/api/governance/ocsf/traces", "listOcsfProjectTraces")
  .withQuery(ocsfTracesQuerySchema)
  .withPermission("complianceExport:view")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(ocsfEventsPageSchema)
  .withDocs({
    operationId: "getApiGovernanceOcsfTraces",
    summary: "Export project traces as OCSF 1.9.0",
    tags: TAGS,
    description: `The traces of the organisation's projects as OCSF 1.9.0 API Activity events, one per trace, with \`ai_model\`, \`ai_agent\`, token counts and cost. A trace updated again is exported again under the same \`metadata.uid\`; deduplicate on it. \`project_id\` limits the read to one project of the organisation. ${PAGING}`,
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listOcsfProjectTraces({
      organizationId: scope.id,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.since ? { since: input.since } : {}),
      ...(input.until ? { until: input.until } : {}),
      ...(input.project_id ? { projectId: input.project_id } : {}),
    }),
  )

  .get("/api/governance/ocsf/audit", "listOcsfAudit")
  .withQuery(ocsfAuditQuerySchema)
  .withPermission("complianceExport:view")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(ocsfEventsPageSchema)
  .withDocs({
    operationId: "getApiGovernanceOcsfAudit",
    summary: "Export the audit log as OCSF 1.9.0",
    tags: TAGS,
    description: `The organisation's audit log as OCSF 1.9.0 API Activity events, oldest first: who did what, on which target, from which address, and whether it failed. ${PAGING}`,
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope }) =>
    app.listOcsfAudit({
      organizationId: scope.id,
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.since ? { since: input.since } : {}),
      ...(input.until ? { until: input.until } : {}),
    }),
  )

  .post("/api/governance/ocsf/ingest", "ingestOcsfEvents")
  .keepsRecords()
  .withAudit("governance.ocsfEvents.ingest")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withInput(ocsfIngestRequestSchema)
  .withPermission("governance:manage")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(ocsfIngestResponseSchema)
  .withDocs({
    operationId: "postApiGovernanceOcsfIngest",
    summary: "Push OCSF events in from another source",
    tags: TAGS,
    description:
      "Stores up to 500 OCSF events from another tool, named by `source`. Each event needs `class_uid`, `severity_id`, `time` (epoch ms) and `metadata.uid` and `metadata.version`, and is at most 64 KiB as UTF-8 JSON; the request body is at most 10 MiB. An event is identified by `source` and `metadata.uid`: sending it again replaces it. Stored events are returned by `GET /api/governance/ocsf/events` with `source_type=ocsf_push`, as received, and are not pushed to webhook endpoints.",
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope }) => app.ingestOcsfEvents({ ...input, organizationId: scope.id }))

  .post("/api/governance/security-lake/sources", "createSecurityLakeSource")
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .keepsRecords()
  .withAudit("ingestionSources.create")
  .withInput(securityLakeSourceCreateInputSchema)
  .withPermission("ingestionSources:manage")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(securityLakeSourceSchema)
  .withDocs({
    operationId: "postApiGovernanceSecurityLakeSources",
    summary: "Add an AWS Security Lake source",
    tags: LAKE_TAGS,
    description:
      "Adds a Security Lake subscriber as an ingestion source. LangWatch reads the subscriber's SQS queue on `config.schedule` (every 5 minutes by default), decodes each Parquet object, keeps the AI activity (Bedrock, SageMaker endpoints, Bedrock agents) and stores it as OCSF events with `source_type` `security_lake`. The access keys are stored sealed and never returned. LangWatch generates the source's `externalId` and returns it; the subscriber role's trust policy must require it as the `sts:ExternalId` condition.",
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope, actor }) =>
    app.securityLakeSourceCreate({
      ...input,
      organizationId: scope.id,
      actorUserId: actor?.type === "user" ? actor.id : null,
    }),
  )

  .patch("/api/governance/security-lake/sources/:sourceId", "updateSecurityLakeSource")
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .keepsRecords()
  .withAudit("ingestionSources.update")
  .withParams(sourceParams)
  .withInput(securityLakeSourceUpdateInputSchema)
  .withPermission("ingestionSources:manage")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(securityLakeSourceSchema)
  .withDocs({
    operationId: "patchApiGovernanceSecurityLakeSourcesById",
    summary: "Edit an AWS Security Lake source",
    tags: LAKE_TAGS,
    description:
      "Changes the name, queue settings, sources, schedule, access keys or status of a Security Lake source. Fields left out keep their stored value. The external id stays as LangWatch generated it.",
    responses: { ...canonicalBaseResponses, ...canonicalUnprocessableResponses },
  })
  .handle(({ app, input, scope }) =>
    app.securityLakeSourceUpdate({ ...input, id: input.sourceId, organizationId: scope.id }),
  )

  .post("/api/governance/security-lake/sources/:sourceId/test", "testSecurityLakeSource")
  .withoutAudit("reads the queue backlog and changes nothing")
  .withoutConfirmation("reads the queue backlog and changes nothing")
  .withParams(sourceParams)
  .withInput(securityLakeConnectionTestInputSchema)
  .withPermission("ingestionSources:manage")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(securityLakeConnectionTestSchema)
  .withDocs({
    operationId: "postApiGovernanceSecurityLakeSourcesByIdTest",
    summary: "Test a Security Lake source's connection",
    tags: LAKE_TAGS,
    description:
      "Reads the subscriber queue's backlog without taking a message. Settings and keys in the body are tested over the stored ones and not saved; an empty body tests the stored source. `ok` is false with the AWS error code when the queue refused or could not be reached.",
    responses: { ...canonicalBaseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.securityLakeSourceTest({
      ...(input.config === undefined ? {} : { config: input.config }),
      ...(input.credentials === undefined ? {} : { credentials: input.credentials }),
      id: input.sourceId,
      organizationId: scope.id,
    }),
  )

  .get("/api/governance/security-lake/sources/:sourceId", "getSecurityLakeSource")
  .withParams(sourceParams)
  .withPermission("ingestionSources:manage")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(securityLakeSourceSchema)
  .withDocs({
    operationId: "getApiGovernanceSecurityLakeSourcesById",
    summary: "Read a Security Lake source",
    tags: LAKE_TAGS,
    description:
      "The source's settings and the external id LangWatch generated for it. The subscriber role's trust policy must require this external id as the `sts:ExternalId` condition.",
    responses: { ...canonicalBaseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.securityLakeSourceGet({ id: input.sourceId, organizationId: scope.id }),
  )

  .get("/api/governance/security-lake/sources/:sourceId/health", "getSecurityLakeSourceHealth")
  .withParams(sourceParams)
  .withPermission("ingestionSources:view")
  .withEntitlement("enterprise", { feature: "OCSF_EXPORT" })
  .withOutput(securityLakeSourceHealthSchema)
  .withDocs({
    operationId: "getApiGovernanceSecurityLakeSourcesByIdHealth",
    summary: "Read a Security Lake source's health",
    tags: LAKE_TAGS,
    description:
      "The source's last read time, lag (from the oldest event written in the last run to that run), running counts of messages, objects, rows, events written and dropped, the last run's error, and the latest poison objects the reader gave up on.",
    responses: { ...canonicalBaseResponses },
  })
  .handle(({ app, input, scope }) =>
    app.securityLakeSourceHealth({ id: input.sourceId, organizationId: scope.id }),
  )
  .build();
