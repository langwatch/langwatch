-- An older version's PostgreSQL converge, frozen: the statements langwatch at commit
-- a6e686478b9e1f86344ce9e1ad1d5f60c130f4be (the production langwatch-app version at the time,
-- git-a6e68647) emits for schema public and reader role lwql_ro. Do NOT regenerate this file
-- from this branch or any later commit: it exists so the old-converge suite replays the old
-- code's own statements, not the current code's. It sets the lwql_ro login password to
-- 'scope-test-pw' (ALTER ROLE ... WITH LOGIN PASSWORD), which must equal LOGIN_PASSWORD in
-- langwatch-ql-postgres-reader-scope.fixtures.ts.
--
-- Generated in a checkout detached at that commit with:
--   node --experimental-transform-types --import ./hooks.mjs gen.ts > older-converge-a6e68647.sql
-- where hooks.mjs resolves the checkout's @langwatch/* packages to its own sources (package
-- self-reference) and third-party packages through a current install's node_modules, and
-- gen.ts writes this header and then, each after a '-- statement N' line, these statements:
--   ...LangWatchQLProductionProvisioningService.create()
--     .postgresApprovedViewStatements({ schema: "public", readerRole: "lwql_ro" }),
--   ...LangWatchQLPostgresMappingService.create().readerRoleStatements({ reader: {
--     role: "lwql_ro", password: "scope-test-pw", schema: "public",
--     approvedViews: LangWatchQLPostgresViewsService.create().approvedViewNames(),
--     ...DEFAULT_POSTGRES_READER_LIMITS } }),

-- statement 1
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_agents" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AgentId",
  "m"."name" AS "Name",
  "m"."type" AS "Type",
  "m"."workflowId" AS "WorkflowId",
  "m"."copiedFromAgentId" AS "CopiedFromAgentId",
  "m"."environment" AS "Environment",
  "m"."ownerUserId" AS "OwnerUserId",
  "m"."hostLabel" AS "HostLabel",
  "m"."lastSeenAt" AS "LastSeenAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Agent" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_agents";
    CREATE VIEW "public"."lwql_agents" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AgentId",
  "m"."name" AS "Name",
  "m"."type" AS "Type",
  "m"."workflowId" AS "WorkflowId",
  "m"."copiedFromAgentId" AS "CopiedFromAgentId",
  "m"."environment" AS "Environment",
  "m"."ownerUserId" AS "OwnerUserId",
  "m"."hostLabel" AS "HostLabel",
  "m"."lastSeenAt" AS "LastSeenAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Agent" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_agents" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 2
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_ai_tool_entries" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AiToolEntryId",
  "m"."scope" AS "Scope",
  "m"."scopeId" AS "ScopeId",
  "m"."type" AS "Type",
  "m"."displayName" AS "DisplayName",
  "m"."slug" AS "Slug",
  "m"."iconAsset" AS "IconAsset",
  "m"."order" AS "Order",
  "m"."enabled" AS "Enabled",
  "m"."config" AS "Config",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."AiToolEntry" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_ai_tool_entries";
    CREATE VIEW "public"."lwql_ai_tool_entries" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AiToolEntryId",
  "m"."scope" AS "Scope",
  "m"."scopeId" AS "ScopeId",
  "m"."type" AS "Type",
  "m"."displayName" AS "DisplayName",
  "m"."slug" AS "Slug",
  "m"."iconAsset" AS "IconAsset",
  "m"."order" AS "Order",
  "m"."enabled" AS "Enabled",
  "m"."config" AS "Config",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."AiToolEntry" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_ai_tool_entries" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 3
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_ai_tool_entry_departments" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AiToolEntryDepartmentId",
  "m"."entryId" AS "EntryId",
  "m"."departmentId" AS "DepartmentId"
FROM "public"."AiToolEntryDepartment" AS "m"
JOIN "public"."AiToolEntry" AS "j0" ON "m"."entryId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_ai_tool_entry_departments";
    CREATE VIEW "public"."lwql_ai_tool_entry_departments" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AiToolEntryDepartmentId",
  "m"."entryId" AS "EntryId",
  "m"."departmentId" AS "DepartmentId"
FROM "public"."AiToolEntryDepartment" AS "m"
JOIN "public"."AiToolEntry" AS "j0" ON "m"."entryId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_ai_tool_entry_departments" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 4
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_ai_tool_entry_teams" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AiToolEntryTeamId",
  "m"."entryId" AS "EntryId"
FROM "public"."AiToolEntryTeam" AS "m"
JOIN "public"."Project" AS "p" ON "m"."teamId" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_ai_tool_entry_teams";
    CREATE VIEW "public"."lwql_ai_tool_entry_teams" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AiToolEntryTeamId",
  "m"."entryId" AS "EntryId"
FROM "public"."AiToolEntryTeam" AS "m"
JOIN "public"."Project" AS "p" ON "m"."teamId" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_ai_tool_entry_teams" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 5
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_analytics" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnalyticsId",
  "m"."value" AS "ValueJson",
  "m"."numericValue" AS "NumericValue",
  "m"."stringValue" AS "StringValue",
  "m"."boolValue" AS "BoolValue",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."Analytics" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_analytics";
    CREATE VIEW "public"."lwql_analytics" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnalyticsId",
  "m"."value" AS "ValueJson",
  "m"."numericValue" AS "NumericValue",
  "m"."stringValue" AS "StringValue",
  "m"."boolValue" AS "BoolValue",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."Analytics" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_analytics" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 6
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_annotation_queue_items" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationQueueItemId",
  "m"."annotationQueueId" AS "AnnotationQueueId",
  "m"."userId" AS "UserId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdByUserId" AS "CreatedByUserId",
  "m"."traceId" AS "TraceId",
  "m"."doneAt" AS "DoneAt",
  "m"."markedForDatasetAt" AS "MarkedForDatasetAt"
FROM "public"."AnnotationQueueItem" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_annotation_queue_items";
    CREATE VIEW "public"."lwql_annotation_queue_items" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationQueueItemId",
  "m"."annotationQueueId" AS "AnnotationQueueId",
  "m"."userId" AS "UserId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdByUserId" AS "CreatedByUserId",
  "m"."traceId" AS "TraceId",
  "m"."doneAt" AS "DoneAt",
  "m"."markedForDatasetAt" AS "MarkedForDatasetAt"
FROM "public"."AnnotationQueueItem" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_annotation_queue_items" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 7
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_annotation_queue_scores" AS
SELECT
  "j0"."projectId" AS "TenantId",
  "m"."annotationQueueId" AS "AnnotationQueueId",
  "m"."annotationScoreId" AS "AnnotationScoreId"
FROM "public"."AnnotationQueueScores" AS "m"
JOIN "public"."AnnotationQueue" AS "j0" ON "m"."annotationQueueId" = "j0"."id";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_annotation_queue_scores";
    CREATE VIEW "public"."lwql_annotation_queue_scores" AS
SELECT
  "j0"."projectId" AS "TenantId",
  "m"."annotationQueueId" AS "AnnotationQueueId",
  "m"."annotationScoreId" AS "AnnotationScoreId"
FROM "public"."AnnotationQueueScores" AS "m"
JOIN "public"."AnnotationQueue" AS "j0" ON "m"."annotationQueueId" = "j0"."id";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_annotation_queue_scores" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 8
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_annotation_queues" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationQueueId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."description" AS "Description",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."AnnotationQueue" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_annotation_queues";
    CREATE VIEW "public"."lwql_annotation_queues" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationQueueId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."description" AS "Description",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."AnnotationQueue" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_annotation_queues" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 9
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_annotation_scores" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationScoreId",
  "m"."name" AS "Name",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."deletedAt" AS "DeletedAt",
  "m"."description" AS "Description",
  "m"."active" AS "Active",
  "m"."dataType" AS "DataType",
  "m"."options" AS "Options",
  "m"."defaultValue" AS "DefaultValue",
  "m"."global" AS "Global"
FROM "public"."AnnotationScore" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_annotation_scores";
    CREATE VIEW "public"."lwql_annotation_scores" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationScoreId",
  "m"."name" AS "Name",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."deletedAt" AS "DeletedAt",
  "m"."description" AS "Description",
  "m"."active" AS "Active",
  "m"."dataType" AS "DataType",
  "m"."options" AS "Options",
  "m"."defaultValue" AS "DefaultValue",
  "m"."global" AS "Global"
FROM "public"."AnnotationScore" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_annotation_scores" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 10
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_annotations" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationId",
  "m"."traceId" AS "TraceId",
  "m"."comment" AS "Comment",
  "m"."isThumbsUp" AS "IsThumbsUp",
  "m"."userId" AS "UserId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."scoreOptions" AS "ScoreOptions",
  "m"."expectedOutput" AS "ExpectedOutput",
  "m"."anchorKind" AS "AnchorKind",
  "m"."anchorId" AS "AnchorId",
  "m"."anchorPath" AS "AnchorPath"
FROM "public"."Annotation" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_annotations";
    CREATE VIEW "public"."lwql_annotations" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "AnnotationId",
  "m"."traceId" AS "TraceId",
  "m"."comment" AS "Comment",
  "m"."isThumbsUp" AS "IsThumbsUp",
  "m"."userId" AS "UserId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."scoreOptions" AS "ScoreOptions",
  "m"."expectedOutput" AS "ExpectedOutput",
  "m"."anchorKind" AS "AnchorKind",
  "m"."anchorId" AS "AnchorId",
  "m"."anchorPath" AS "AnchorPath"
FROM "public"."Annotation" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_annotations" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 11
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_anomaly_alerts" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AnomalyAlertId",
  "m"."ruleId" AS "RuleId",
  "m"."severity" AS "Severity",
  "m"."ruleName" AS "RuleName",
  "m"."ruleType" AS "RuleType",
  "m"."triggerWindowStart" AS "TriggerWindowStart",
  "m"."triggerWindowEnd" AS "TriggerWindowEnd",
  "m"."triggerSpendUsd" AS "TriggerSpendUsd",
  "m"."triggerEventCount" AS "TriggerEventCount",
  "m"."detail" AS "Detail",
  "m"."state" AS "State",
  "m"."destinationStatus" AS "DestinationStatus",
  "m"."detectedAt" AS "DetectedAt",
  "m"."acknowledgedAt" AS "AcknowledgedAt",
  "m"."resolvedAt" AS "ResolvedAt"
FROM "public"."AnomalyAlert" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_anomaly_alerts";
    CREATE VIEW "public"."lwql_anomaly_alerts" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AnomalyAlertId",
  "m"."ruleId" AS "RuleId",
  "m"."severity" AS "Severity",
  "m"."ruleName" AS "RuleName",
  "m"."ruleType" AS "RuleType",
  "m"."triggerWindowStart" AS "TriggerWindowStart",
  "m"."triggerWindowEnd" AS "TriggerWindowEnd",
  "m"."triggerSpendUsd" AS "TriggerSpendUsd",
  "m"."triggerEventCount" AS "TriggerEventCount",
  "m"."detail" AS "Detail",
  "m"."state" AS "State",
  "m"."destinationStatus" AS "DestinationStatus",
  "m"."detectedAt" AS "DetectedAt",
  "m"."acknowledgedAt" AS "AcknowledgedAt",
  "m"."resolvedAt" AS "ResolvedAt"
FROM "public"."AnomalyAlert" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_anomaly_alerts" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 12
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_anomaly_rules" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AnomalyRuleId",
  "m"."scope" AS "Scope",
  "m"."scopeId" AS "ScopeId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."severity" AS "Severity",
  "m"."ruleType" AS "RuleType",
  "m"."thresholdConfig" AS "ThresholdConfig",
  "m"."status" AS "Status",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById"
FROM "public"."AnomalyRule" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_anomaly_rules";
    CREATE VIEW "public"."lwql_anomaly_rules" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "AnomalyRuleId",
  "m"."scope" AS "Scope",
  "m"."scopeId" AS "ScopeId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."severity" AS "Severity",
  "m"."ruleType" AS "RuleType",
  "m"."thresholdConfig" AS "ThresholdConfig",
  "m"."status" AS "Status",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById"
FROM "public"."AnomalyRule" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_anomaly_rules" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 13
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_batch_evaluations" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "BatchEvaluationId",
  "m"."experimentId" AS "ExperimentId",
  "m"."data" AS "Data",
  "m"."status" AS "Status",
  "m"."score" AS "Score",
  "m"."label" AS "Label",
  "m"."passed" AS "Passed",
  "m"."details" AS "Details",
  "m"."cost" AS "Cost",
  "m"."datasetSlug" AS "DatasetSlug",
  "m"."datasetId" AS "DatasetId",
  "m"."evaluation" AS "Evaluation",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."BatchEvaluation" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_batch_evaluations";
    CREATE VIEW "public"."lwql_batch_evaluations" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "BatchEvaluationId",
  "m"."experimentId" AS "ExperimentId",
  "m"."data" AS "Data",
  "m"."status" AS "Status",
  "m"."score" AS "Score",
  "m"."label" AS "Label",
  "m"."passed" AS "Passed",
  "m"."details" AS "Details",
  "m"."cost" AS "Cost",
  "m"."datasetSlug" AS "DatasetSlug",
  "m"."datasetId" AS "DatasetId",
  "m"."evaluation" AS "Evaluation",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."BatchEvaluation" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_batch_evaluations" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 14
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_costs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "CostId",
  "m"."costType" AS "CostType",
  "m"."costName" AS "CostName",
  "m"."referenceType" AS "ReferenceType",
  "m"."referenceId" AS "ReferenceId",
  "m"."amount" AS "Amount",
  "m"."currency" AS "Currency",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."extraInfo" AS "ExtraInfo"
FROM "public"."Cost" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_costs";
    CREATE VIEW "public"."lwql_costs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "CostId",
  "m"."costType" AS "CostType",
  "m"."costName" AS "CostName",
  "m"."referenceType" AS "ReferenceType",
  "m"."referenceId" AS "ReferenceId",
  "m"."amount" AS "Amount",
  "m"."currency" AS "Currency",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."extraInfo" AS "ExtraInfo"
FROM "public"."Cost" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_costs" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 15
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_custom_graphs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "CustomGraphId",
  "m"."name" AS "Name",
  "m"."graph" AS "Graph",
  "m"."filters" AS "Filters",
  "m"."kind" AS "Kind",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."dashboardId" AS "DashboardId",
  "m"."gridColumn" AS "GridColumn",
  "m"."gridRow" AS "GridRow",
  "m"."colSpan" AS "ColSpan",
  "m"."rowSpan" AS "RowSpan"
FROM "public"."CustomGraph" AS "m"
WHERE (("m"."kind" <> 'dashboard_srcdoc') AND ("m"."dashboardId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "public"."Dashboard" AS "d"
  WHERE "d"."id" = "m"."dashboardId"
    AND "d"."projectId" = "m"."projectId"
    AND "d"."scope" = 'PRIVATE'
)));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_custom_graphs";
    CREATE VIEW "public"."lwql_custom_graphs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "CustomGraphId",
  "m"."name" AS "Name",
  "m"."graph" AS "Graph",
  "m"."filters" AS "Filters",
  "m"."kind" AS "Kind",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."dashboardId" AS "DashboardId",
  "m"."gridColumn" AS "GridColumn",
  "m"."gridRow" AS "GridRow",
  "m"."colSpan" AS "ColSpan",
  "m"."rowSpan" AS "RowSpan"
FROM "public"."CustomGraph" AS "m"
WHERE (("m"."kind" <> 'dashboard_srcdoc') AND ("m"."dashboardId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "public"."Dashboard" AS "d"
  WHERE "d"."id" = "m"."dashboardId"
    AND "d"."projectId" = "m"."projectId"
    AND "d"."scope" = 'PRIVATE'
)));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_custom_graphs" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 16
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_custom_llm_model_costs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "CustomLLMModelCostId",
  "m"."organizationId" AS "OrganizationId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."model" AS "Model",
  "m"."regex" AS "Regex",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."CustomLLMModelCost" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_custom_llm_model_costs";
    CREATE VIEW "public"."lwql_custom_llm_model_costs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "CustomLLMModelCostId",
  "m"."organizationId" AS "OrganizationId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."model" AS "Model",
  "m"."regex" AS "Regex",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."CustomLLMModelCost" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_custom_llm_model_costs" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 17
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_dashboard_widgets" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DashboardWidgetId",
  "m"."dashboardId" AS "DashboardId",
  "m"."name" AS "Name",
  "m"."definition" AS "Definition",
  "m"."gridColumn" AS "GridColumn",
  "m"."gridRow" AS "GridRow",
  "m"."colSpan" AS "ColSpan",
  "m"."rowSpan" AS "RowSpan",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DashboardWidget" AS "m"
WHERE ("m"."dashboardId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "public"."DashboardsV2" AS "d"
  WHERE "d"."id" = "m"."dashboardId"
    AND "d"."projectId" = "m"."projectId"
    AND "d"."scope" = 'PRIVATE'
));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_dashboard_widgets";
    CREATE VIEW "public"."lwql_dashboard_widgets" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DashboardWidgetId",
  "m"."dashboardId" AS "DashboardId",
  "m"."name" AS "Name",
  "m"."definition" AS "Definition",
  "m"."gridColumn" AS "GridColumn",
  "m"."gridRow" AS "GridRow",
  "m"."colSpan" AS "ColSpan",
  "m"."rowSpan" AS "RowSpan",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DashboardWidget" AS "m"
WHERE ("m"."dashboardId" IS NULL OR NOT EXISTS (
  SELECT 1 FROM "public"."DashboardsV2" AS "d"
  WHERE "d"."id" = "m"."dashboardId"
    AND "d"."projectId" = "m"."projectId"
    AND "d"."scope" = 'PRIVATE'
));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_dashboard_widgets" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 18
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_dashboards" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DashboardId",
  "m"."name" AS "Name",
  "m"."order" AS "Order",
  "m"."description" AS "Description",
  "m"."createdById" AS "CreatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Dashboard" AS "m"
WHERE (("m"."scope" <> 'PRIVATE') AND (NOT EXISTS (
  SELECT 1 FROM "public"."DashboardsV2" AS "v"
  WHERE "v"."id" = "m"."id"
    AND "v"."projectId" = "m"."projectId"
) OR EXISTS (
  SELECT 1 FROM "public"."CustomGraph" AS "g"
  WHERE "g"."dashboardId" = "m"."id"
    AND "g"."projectId" = "m"."projectId"
    AND "g"."kind" <> 'dashboard_srcdoc'
)));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_dashboards";
    CREATE VIEW "public"."lwql_dashboards" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DashboardId",
  "m"."name" AS "Name",
  "m"."order" AS "Order",
  "m"."description" AS "Description",
  "m"."createdById" AS "CreatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Dashboard" AS "m"
WHERE (("m"."scope" <> 'PRIVATE') AND (NOT EXISTS (
  SELECT 1 FROM "public"."DashboardsV2" AS "v"
  WHERE "v"."id" = "m"."id"
    AND "v"."projectId" = "m"."projectId"
) OR EXISTS (
  SELECT 1 FROM "public"."CustomGraph" AS "g"
  WHERE "g"."dashboardId" = "m"."id"
    AND "g"."projectId" = "m"."projectId"
    AND "g"."kind" <> 'dashboard_srcdoc'
)));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_dashboards" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 19
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_dashboards_v2" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DashboardId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."createdById" AS "CreatedById",
  "m"."scope" AS "Scope",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DashboardsV2" AS "m"
WHERE ("m"."scope" <> 'PRIVATE');
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_dashboards_v2";
    CREATE VIEW "public"."lwql_dashboards_v2" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DashboardId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."createdById" AS "CreatedById",
  "m"."scope" AS "Scope",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DashboardsV2" AS "m"
WHERE ("m"."scope" <> 'PRIVATE');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_dashboards_v2" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 20
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_data_privacy_policies" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DataPrivacyPolicyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."personalOnly" AS "PersonalOnly",
  "m"."config" AS "Config",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DataPrivacyPolicy" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_data_privacy_policies";
    CREATE VIEW "public"."lwql_data_privacy_policies" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DataPrivacyPolicyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."personalOnly" AS "PersonalOnly",
  "m"."config" AS "Config",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DataPrivacyPolicy" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_data_privacy_policies" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 21
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_dataset_records" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DatasetRecordId",
  "m"."datasetId" AS "DatasetId",
  "m"."entry" AS "Entry",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DatasetRecord" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_dataset_records";
    CREATE VIEW "public"."lwql_dataset_records" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DatasetRecordId",
  "m"."datasetId" AS "DatasetId",
  "m"."entry" AS "Entry",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DatasetRecord" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_dataset_records" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 22
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_datasets" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DatasetId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."columnTypes" AS "ColumnTypes",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."mapping" AS "Mapping",
  "m"."useS3" AS "UseS3",
  "m"."s3RecordCount" AS "S3RecordCount",
  "m"."contentLayout" AS "ContentLayout",
  "m"."status" AS "Status",
  "m"."statusError" AS "StatusError",
  "m"."sourceStoredObjectId" AS "SourceStoredObjectId",
  "m"."uploadFilename" AS "UploadFilename",
  "m"."rowCount" AS "RowCount",
  "m"."sizeBytes" AS "SizeBytes",
  "m"."chunkCount" AS "ChunkCount",
  "m"."chunkOffsets" AS "ChunkOffsets"
FROM "public"."Dataset" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_datasets";
    CREATE VIEW "public"."lwql_datasets" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "DatasetId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."columnTypes" AS "ColumnTypes",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."mapping" AS "Mapping",
  "m"."useS3" AS "UseS3",
  "m"."s3RecordCount" AS "S3RecordCount",
  "m"."contentLayout" AS "ContentLayout",
  "m"."status" AS "Status",
  "m"."statusError" AS "StatusError",
  "m"."sourceStoredObjectId" AS "SourceStoredObjectId",
  "m"."uploadFilename" AS "UploadFilename",
  "m"."rowCount" AS "RowCount",
  "m"."sizeBytes" AS "SizeBytes",
  "m"."chunkCount" AS "ChunkCount",
  "m"."chunkOffsets" AS "ChunkOffsets"
FROM "public"."Dataset" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_datasets" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 23
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_department_membership_histories" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DepartmentMembershipHistoryId",
  "m"."userId" AS "UserId",
  "m"."departmentId" AS "DepartmentId",
  "m"."validFrom" AS "ValidFrom",
  "m"."validTo" AS "ValidTo",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."DepartmentMembershipHistory" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_department_membership_histories";
    CREATE VIEW "public"."lwql_department_membership_histories" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DepartmentMembershipHistoryId",
  "m"."userId" AS "UserId",
  "m"."departmentId" AS "DepartmentId",
  "m"."validFrom" AS "ValidFrom",
  "m"."validTo" AS "ValidTo",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."DepartmentMembershipHistory" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_department_membership_histories" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 24
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_departments" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DepartmentId",
  "m"."name" AS "Name",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."archivedAt" AS "ArchivedAt"
FROM "public"."Department" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_departments";
    CREATE VIEW "public"."lwql_departments" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DepartmentId",
  "m"."name" AS "Name",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."archivedAt" AS "ArchivedAt"
FROM "public"."Department" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_departments" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 25
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_discovered_agents" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DiscoveredAgentId",
  "m"."provider" AS "Provider",
  "m"."rawAgentId" AS "RawAgentId",
  "m"."displayText" AS "DisplayText",
  "m"."metadata" AS "Metadata",
  "m"."firstSeenAt" AS "FirstSeenAt",
  "m"."lastSeenAt" AS "LastSeenAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DiscoveredAgent" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_discovered_agents";
    CREATE VIEW "public"."lwql_discovered_agents" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DiscoveredAgentId",
  "m"."provider" AS "Provider",
  "m"."rawAgentId" AS "RawAgentId",
  "m"."displayText" AS "DisplayText",
  "m"."metadata" AS "Metadata",
  "m"."firstSeenAt" AS "FirstSeenAt",
  "m"."lastSeenAt" AS "LastSeenAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DiscoveredAgent" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_discovered_agents" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 26
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_discovered_persons" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DiscoveredPersonId",
  "m"."provider" AS "Provider",
  "m"."kind" AS "Kind",
  "m"."department" AS "Department",
  "m"."firstSeenAt" AS "FirstSeenAt",
  "m"."lastSeenAt" AS "LastSeenAt",
  "m"."erasedAt" AS "ErasedAt",
  "m"."moneyRowsPendingAt" AS "MoneyRowsPendingAt",
  "m"."moneyRebuildSince" AS "MoneyRebuildSince",
  "m"."suspendedAt" AS "SuspendedAt",
  "m"."suspendedReason" AS "SuspendedReason",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DiscoveredPerson" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_discovered_persons";
    CREATE VIEW "public"."lwql_discovered_persons" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "DiscoveredPersonId",
  "m"."provider" AS "Provider",
  "m"."kind" AS "Kind",
  "m"."department" AS "Department",
  "m"."firstSeenAt" AS "FirstSeenAt",
  "m"."lastSeenAt" AS "LastSeenAt",
  "m"."erasedAt" AS "ErasedAt",
  "m"."moneyRowsPendingAt" AS "MoneyRowsPendingAt",
  "m"."moneyRebuildSince" AS "MoneyRebuildSince",
  "m"."suspendedAt" AS "SuspendedAt",
  "m"."suspendedReason" AS "SuspendedReason",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."DiscoveredPerson" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_discovered_persons" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 27
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_email_suppressions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "EmailSuppressionId",
  "m"."triggerId" AS "TriggerId",
  "m"."reason" AS "Reason",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."EmailSuppression" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_email_suppressions";
    CREATE VIEW "public"."lwql_email_suppressions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "EmailSuppressionId",
  "m"."triggerId" AS "TriggerId",
  "m"."reason" AS "Reason",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."EmailSuppression" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_email_suppressions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 28
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_erased_identifier_suppressions" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ErasedIdentifierSuppressionId",
  "m"."provider" AS "Provider",
  "m"."erasedAt" AS "ErasedAt"
FROM "public"."ErasedIdentifierSuppression" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_erased_identifier_suppressions";
    CREATE VIEW "public"."lwql_erased_identifier_suppressions" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ErasedIdentifierSuppressionId",
  "m"."provider" AS "Provider",
  "m"."erasedAt" AS "ErasedAt"
FROM "public"."ErasedIdentifierSuppression" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_erased_identifier_suppressions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 29
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_evaluators" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "EvaluatorId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."type" AS "Type",
  "m"."config" AS "Config",
  "m"."workflowId" AS "WorkflowId",
  "m"."copiedFromEvaluatorId" AS "CopiedFromEvaluatorId",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Evaluator" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_evaluators";
    CREATE VIEW "public"."lwql_evaluators" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "EvaluatorId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."type" AS "Type",
  "m"."config" AS "Config",
  "m"."workflowId" AS "WorkflowId",
  "m"."copiedFromEvaluatorId" AS "CopiedFromEvaluatorId",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Evaluator" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_evaluators" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 30
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_experiment_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ExperimentVersionId",
  "m"."experimentId" AS "ExperimentId",
  "m"."version" AS "Version",
  "m"."counterVersion" AS "CounterVersion",
  "m"."autoSaved" AS "AutoSaved",
  "m"."commitMessage" AS "CommitMessage",
  "m"."authorId" AS "AuthorId",
  "m"."authorLabel" AS "AuthorLabel",
  "m"."runId" AS "RunId",
  "m"."state" AS "State",
  "m"."schemaVersion" AS "SchemaVersion",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ExperimentVersion" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_experiment_versions";
    CREATE VIEW "public"."lwql_experiment_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ExperimentVersionId",
  "m"."experimentId" AS "ExperimentId",
  "m"."version" AS "Version",
  "m"."counterVersion" AS "CounterVersion",
  "m"."autoSaved" AS "AutoSaved",
  "m"."commitMessage" AS "CommitMessage",
  "m"."authorId" AS "AuthorId",
  "m"."authorLabel" AS "AuthorLabel",
  "m"."runId" AS "RunId",
  "m"."state" AS "State",
  "m"."schemaVersion" AS "SchemaVersion",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ExperimentVersion" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_experiment_versions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 31
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_experiments" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ExperimentId",
  "m"."name" AS "ExperimentName",
  "m"."type" AS "ExperimentType",
  "m"."slug" AS "ExperimentSlug",
  "m"."workflowId" AS "WorkflowId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."workbenchState" AS "WorkbenchState",
  "m"."workbenchVersion" AS "WorkbenchVersion"
FROM "public"."Experiment" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_experiments";
    CREATE VIEW "public"."lwql_experiments" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ExperimentId",
  "m"."name" AS "ExperimentName",
  "m"."type" AS "ExperimentType",
  "m"."slug" AS "ExperimentSlug",
  "m"."workflowId" AS "WorkflowId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."workbenchState" AS "WorkbenchState",
  "m"."workbenchVersion" AS "WorkbenchVersion"
FROM "public"."Experiment" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_experiments" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 32
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_budget_bucket_boundaries" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayBudgetBucketBoundaryId",
  "m"."budgetId" AS "BudgetId",
  "m"."bucketScopeId" AS "BucketScopeId",
  "m"."periodStartedAt" AS "PeriodStartedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GatewayBudgetBucketBoundary" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_budget_bucket_boundaries";
    CREATE VIEW "public"."lwql_gateway_budget_bucket_boundaries" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayBudgetBucketBoundaryId",
  "m"."budgetId" AS "BudgetId",
  "m"."bucketScopeId" AS "BucketScopeId",
  "m"."periodStartedAt" AS "PeriodStartedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GatewayBudgetBucketBoundary" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_budget_bucket_boundaries" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 33
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_budget_ledgers" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayBudgetLedgerId",
  "m"."budgetId" AS "BudgetId",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."gatewayRequestId" AS "GatewayRequestId",
  "m"."amountUsd" AS "AmountUsd",
  "m"."tokensInput" AS "TokensInput",
  "m"."tokensOutput" AS "TokensOutput",
  "m"."tokensCacheRead" AS "TokensCacheRead",
  "m"."tokensCacheWrite" AS "TokensCacheWrite",
  "m"."model" AS "Model",
  "m"."durationMs" AS "DurationMs",
  "m"."status" AS "Status",
  "m"."occurredAt" AS "OccurredAt"
FROM "public"."GatewayBudgetLedger" AS "m"
JOIN "public"."GatewayBudget" AS "j0" ON "m"."budgetId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_budget_ledgers";
    CREATE VIEW "public"."lwql_gateway_budget_ledgers" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayBudgetLedgerId",
  "m"."budgetId" AS "BudgetId",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."gatewayRequestId" AS "GatewayRequestId",
  "m"."amountUsd" AS "AmountUsd",
  "m"."tokensInput" AS "TokensInput",
  "m"."tokensOutput" AS "TokensOutput",
  "m"."tokensCacheRead" AS "TokensCacheRead",
  "m"."tokensCacheWrite" AS "TokensCacheWrite",
  "m"."model" AS "Model",
  "m"."durationMs" AS "DurationMs",
  "m"."status" AS "Status",
  "m"."occurredAt" AS "OccurredAt"
FROM "public"."GatewayBudgetLedger" AS "m"
JOIN "public"."GatewayBudget" AS "j0" ON "m"."budgetId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_budget_ledgers" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 34
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_budgets" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayBudgetId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."window" AS "Window",
  "m"."limitUsd" AS "LimitUsd",
  "m"."onBreach" AS "OnBreach",
  "m"."timezone" AS "Timezone",
  "m"."externalId" AS "ExternalId",
  "m"."metadata" AS "Metadata",
  "m"."spentUsd" AS "SpentUsd",
  "m"."currentPeriodStartedAt" AS "CurrentPeriodStartedAt",
  "m"."resetsAt" AS "ResetsAt",
  "m"."lastResetAt" AS "LastResetAt",
  "m"."cycleAnchorAt" AS "CycleAnchorAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."managedByVirtualKeyId" AS "ManagedByVirtualKeyId"
FROM "public"."GatewayBudget" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_budgets";
    CREATE VIEW "public"."lwql_gateway_budgets" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayBudgetId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."window" AS "Window",
  "m"."limitUsd" AS "LimitUsd",
  "m"."onBreach" AS "OnBreach",
  "m"."timezone" AS "Timezone",
  "m"."externalId" AS "ExternalId",
  "m"."metadata" AS "Metadata",
  "m"."spentUsd" AS "SpentUsd",
  "m"."currentPeriodStartedAt" AS "CurrentPeriodStartedAt",
  "m"."resetsAt" AS "ResetsAt",
  "m"."lastResetAt" AS "LastResetAt",
  "m"."cycleAnchorAt" AS "CycleAnchorAt",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."managedByVirtualKeyId" AS "ManagedByVirtualKeyId"
FROM "public"."GatewayBudget" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_budgets" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 35
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_cache_rules" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayCacheRuleId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."priority" AS "Priority",
  "m"."enabled" AS "Enabled",
  "m"."matchers" AS "Matchers",
  "m"."action" AS "ActionConfig",
  "m"."modeEnum" AS "ModeEnum",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById"
FROM "public"."GatewayCacheRule" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_cache_rules";
    CREATE VIEW "public"."lwql_gateway_cache_rules" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GatewayCacheRuleId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."priority" AS "Priority",
  "m"."enabled" AS "Enabled",
  "m"."matchers" AS "Matchers",
  "m"."action" AS "ActionConfig",
  "m"."modeEnum" AS "ModeEnum",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById"
FROM "public"."GatewayCacheRule" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_cache_rules" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 36
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_change_events" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."revision" AS "Revision",
  "m"."organizationId" AS "OrganizationId",
  "m"."kind" AS "Kind",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."budgetId" AS "BudgetId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."payload" AS "Payload",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."GatewayChangeEvent" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_change_events";
    CREATE VIEW "public"."lwql_gateway_change_events" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."revision" AS "Revision",
  "m"."organizationId" AS "OrganizationId",
  "m"."kind" AS "Kind",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."budgetId" AS "BudgetId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."payload" AS "Payload",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."GatewayChangeEvent" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_change_events" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 37
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_guardrails" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "GatewayGuardrailId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."evaluatorId" AS "EvaluatorId",
  "m"."direction" AS "Direction",
  "m"."failureMode" AS "FailureMode",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."GatewayGuardrail" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_guardrails";
    CREATE VIEW "public"."lwql_gateway_guardrails" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "GatewayGuardrailId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."evaluatorId" AS "EvaluatorId",
  "m"."direction" AS "Direction",
  "m"."failureMode" AS "FailureMode",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."GatewayGuardrail" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_guardrails" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 38
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_gateway_realtime_sessions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "GatewayRealtimeSessionId",
  "m"."organizationId" AS "OrganizationId",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."vendor" AS "Vendor",
  "m"."agentId" AS "AgentId",
  "m"."model" AS "Model",
  "m"."requestedModel" AS "RequestedModel",
  "m"."vendorConversationId" AS "VendorConversationId",
  "m"."status" AS "Status",
  "m"."mintedAt" AS "MintedAt",
  "m"."closedAt" AS "ClosedAt",
  "m"."closeReason" AS "CloseReason",
  "m"."traceId" AS "TraceId",
  "m"."vendorCostRaw" AS "VendorCostRaw",
  "m"."kind" AS "Kind",
  "m"."metering" AS "Metering",
  "m"."transcriptionModel" AS "TranscriptionModel",
  "m"."lastReportAt" AS "LastReportAt",
  "m"."reportedCostNanoUsd" AS "ReportedCostNanoUsd",
  "m"."reportCount" AS "ReportCount",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GatewayRealtimeSession" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_gateway_realtime_sessions";
    CREATE VIEW "public"."lwql_gateway_realtime_sessions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "GatewayRealtimeSessionId",
  "m"."organizationId" AS "OrganizationId",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."vendor" AS "Vendor",
  "m"."agentId" AS "AgentId",
  "m"."model" AS "Model",
  "m"."requestedModel" AS "RequestedModel",
  "m"."vendorConversationId" AS "VendorConversationId",
  "m"."status" AS "Status",
  "m"."mintedAt" AS "MintedAt",
  "m"."closedAt" AS "ClosedAt",
  "m"."closeReason" AS "CloseReason",
  "m"."traceId" AS "TraceId",
  "m"."vendorCostRaw" AS "VendorCostRaw",
  "m"."kind" AS "Kind",
  "m"."metering" AS "Metering",
  "m"."transcriptionModel" AS "TranscriptionModel",
  "m"."lastReportAt" AS "LastReportAt",
  "m"."reportedCostNanoUsd" AS "ReportedCostNanoUsd",
  "m"."reportCount" AS "ReportCount",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GatewayRealtimeSession" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_gateway_realtime_sessions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 39
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_github_branch_pull_request_checks" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GithubBranchPullRequestCheckId",
  "m"."repositoryHost" AS "RepositoryHost",
  "m"."repositoryFullName" AS "RepositoryFullName",
  "m"."headBranch" AS "HeadBranch",
  "m"."lastCheckedAt" AS "LastCheckedAt",
  "m"."prCount" AS "PrCount",
  "m"."notFoundAt" AS "NotFoundAt",
  "m"."recheckAfter" AS "RecheckAfter",
  "m"."attempts" AS "Attempts",
  "m"."lastRequestedAt" AS "LastRequestedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GithubBranchPullRequestCheck" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_github_branch_pull_request_checks";
    CREATE VIEW "public"."lwql_github_branch_pull_request_checks" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GithubBranchPullRequestCheckId",
  "m"."repositoryHost" AS "RepositoryHost",
  "m"."repositoryFullName" AS "RepositoryFullName",
  "m"."headBranch" AS "HeadBranch",
  "m"."lastCheckedAt" AS "LastCheckedAt",
  "m"."prCount" AS "PrCount",
  "m"."notFoundAt" AS "NotFoundAt",
  "m"."recheckAfter" AS "RecheckAfter",
  "m"."attempts" AS "Attempts",
  "m"."lastRequestedAt" AS "LastRequestedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GithubBranchPullRequestCheck" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_github_branch_pull_request_checks" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 40
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_github_installations" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GithubInstallationId",
  "m"."installationId" AS "InstallationId",
  "m"."accountType" AS "AccountType",
  "m"."accountId" AS "AccountId",
  "m"."repositorySelection" AS "RepositorySelection",
  "m"."repositories" AS "Repositories",
  "m"."suspendedAt" AS "SuspendedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GithubInstallation" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_github_installations";
    CREATE VIEW "public"."lwql_github_installations" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GithubInstallationId",
  "m"."installationId" AS "InstallationId",
  "m"."accountType" AS "AccountType",
  "m"."accountId" AS "AccountId",
  "m"."repositorySelection" AS "RepositorySelection",
  "m"."repositories" AS "Repositories",
  "m"."suspendedAt" AS "SuspendedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GithubInstallation" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_github_installations" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 41
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_github_pull_requests" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GithubPullRequestId",
  "m"."repositoryHost" AS "RepositoryHost",
  "m"."repositoryFullName" AS "RepositoryFullName",
  "m"."headBranch" AS "HeadBranch",
  "m"."prNumber" AS "PrNumber",
  "m"."htmlUrl" AS "HtmlUrl",
  "m"."title" AS "Title",
  "m"."state" AS "State",
  "m"."isDraft" AS "IsDraft",
  "m"."prCreatedAt" AS "PrCreatedAt",
  "m"."prClosedAt" AS "PrClosedAt",
  "m"."prMergedAt" AS "PrMergedAt",
  "m"."prUpdatedAt" AS "PrUpdatedAt",
  "m"."mappedAt" AS "MappedAt",
  "m"."lastCheckedAt" AS "LastCheckedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GithubPullRequest" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_github_pull_requests";
    CREATE VIEW "public"."lwql_github_pull_requests" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GithubPullRequestId",
  "m"."repositoryHost" AS "RepositoryHost",
  "m"."repositoryFullName" AS "RepositoryFullName",
  "m"."headBranch" AS "HeadBranch",
  "m"."prNumber" AS "PrNumber",
  "m"."htmlUrl" AS "HtmlUrl",
  "m"."title" AS "Title",
  "m"."state" AS "State",
  "m"."isDraft" AS "IsDraft",
  "m"."prCreatedAt" AS "PrCreatedAt",
  "m"."prClosedAt" AS "PrClosedAt",
  "m"."prMergedAt" AS "PrMergedAt",
  "m"."prUpdatedAt" AS "PrUpdatedAt",
  "m"."mappedAt" AS "MappedAt",
  "m"."lastCheckedAt" AS "LastCheckedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."GithubPullRequest" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_github_pull_requests" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 42
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_governance_tenant_histories" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GovernanceTenantHistoryId",
  "m"."firstUsedAt" AS "FirstUsedAt",
  "m"."lastUsedAt" AS "LastUsedAt"
FROM "public"."GovernanceTenantHistory" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_governance_tenant_histories";
    CREATE VIEW "public"."lwql_governance_tenant_histories" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "GovernanceTenantHistoryId",
  "m"."firstUsedAt" AS "FirstUsedAt",
  "m"."lastUsedAt" AS "LastUsedAt"
FROM "public"."GovernanceTenantHistory" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_governance_tenant_histories" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 43
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_identity_match_suggestions" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IdentityMatchSuggestionId",
  "m"."discoveredPersonId" AS "DiscoveredPersonId",
  "m"."userId" AS "UserId",
  "m"."score" AS "Score",
  "m"."computedAt" AS "ComputedAt"
FROM "public"."IdentityMatchSuggestion" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_identity_match_suggestions";
    CREATE VIEW "public"."lwql_identity_match_suggestions" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IdentityMatchSuggestionId",
  "m"."discoveredPersonId" AS "DiscoveredPersonId",
  "m"."userId" AS "UserId",
  "m"."score" AS "Score",
  "m"."computedAt" AS "ComputedAt"
FROM "public"."IdentityMatchSuggestion" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_identity_match_suggestions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 44
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_identity_matches" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IdentityMatchId",
  "m"."discoveredPersonId" AS "DiscoveredPersonId",
  "m"."userId" AS "UserId",
  "m"."evidenceKind" AS "EvidenceKind",
  "m"."validFrom" AS "ValidFrom",
  "m"."validTo" AS "ValidTo",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."IdentityMatch" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_identity_matches";
    CREATE VIEW "public"."lwql_identity_matches" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IdentityMatchId",
  "m"."discoveredPersonId" AS "DiscoveredPersonId",
  "m"."userId" AS "UserId",
  "m"."evidenceKind" AS "EvidenceKind",
  "m"."validFrom" AS "ValidFrom",
  "m"."validTo" AS "ValidTo",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."IdentityMatch" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_identity_matches" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 45
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_ingestion_pull_run_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "IngestionPullRunProjectionId",
  "m"."sourceId" AS "SourceId",
  "m"."enabled" AS "Enabled",
  "m"."cron" AS "Cron",
  "m"."cursor" AS "Cursor",
  "m"."lastRunAt" AS "LastRunAt",
  "m"."lastRunOutcome" AS "LastRunOutcome",
  "m"."lastRunEventCount" AS "LastRunEventCount",
  "m"."lastRunError" AS "LastRunError",
  "m"."lastRunErrorCode" AS "LastRunErrorCode",
  "m"."consecutiveErrors" AS "ConsecutiveErrors",
  "m"."lastSuccessAt" AS "LastSuccessAt",
  "m"."lastRunScheduledFor" AS "LastRunScheduledFor",
  "m"."lastReadThroughAt" AS "LastReadThroughAt",
  "m"."lastRunCompleteness" AS "LastRunCompleteness",
  "m"."lastAgentsListingAt" AS "LastAgentsListingAt",
  "m"."lastAgentsListingOutcome" AS "LastAgentsListingOutcome",
  "m"."lastAgentsListingCount" AS "LastAgentsListingCount",
  "m"."lastAgentsListingReason" AS "LastAgentsListingReason",
  "m"."lastAgentsListingStatus" AS "LastAgentsListingStatus",
  "m"."lastPeopleListingAt" AS "LastPeopleListingAt",
  "m"."lastPeopleListingOutcome" AS "LastPeopleListingOutcome",
  "m"."lastPeopleDirectoryCount" AS "LastPeopleDirectoryCount",
  "m"."lastPeopleWithheldCount" AS "LastPeopleWithheldCount",
  "m"."lastPeopleListingReason" AS "LastPeopleListingReason",
  "m"."lastPeopleListingStatus" AS "LastPeopleListingStatus",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."IngestionPullRunProjection" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_ingestion_pull_run_projections";
    CREATE VIEW "public"."lwql_ingestion_pull_run_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "IngestionPullRunProjectionId",
  "m"."sourceId" AS "SourceId",
  "m"."enabled" AS "Enabled",
  "m"."cron" AS "Cron",
  "m"."cursor" AS "Cursor",
  "m"."lastRunAt" AS "LastRunAt",
  "m"."lastRunOutcome" AS "LastRunOutcome",
  "m"."lastRunEventCount" AS "LastRunEventCount",
  "m"."lastRunError" AS "LastRunError",
  "m"."lastRunErrorCode" AS "LastRunErrorCode",
  "m"."consecutiveErrors" AS "ConsecutiveErrors",
  "m"."lastSuccessAt" AS "LastSuccessAt",
  "m"."lastRunScheduledFor" AS "LastRunScheduledFor",
  "m"."lastReadThroughAt" AS "LastReadThroughAt",
  "m"."lastRunCompleteness" AS "LastRunCompleteness",
  "m"."lastAgentsListingAt" AS "LastAgentsListingAt",
  "m"."lastAgentsListingOutcome" AS "LastAgentsListingOutcome",
  "m"."lastAgentsListingCount" AS "LastAgentsListingCount",
  "m"."lastAgentsListingReason" AS "LastAgentsListingReason",
  "m"."lastAgentsListingStatus" AS "LastAgentsListingStatus",
  "m"."lastPeopleListingAt" AS "LastPeopleListingAt",
  "m"."lastPeopleListingOutcome" AS "LastPeopleListingOutcome",
  "m"."lastPeopleDirectoryCount" AS "LastPeopleDirectoryCount",
  "m"."lastPeopleWithheldCount" AS "LastPeopleWithheldCount",
  "m"."lastPeopleListingReason" AS "LastPeopleListingReason",
  "m"."lastPeopleListingStatus" AS "LastPeopleListingStatus",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."IngestionPullRunProjection" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_ingestion_pull_run_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 46
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_ingestion_sources" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IngestionSourceId",
  "m"."organizationId" AS "OrganizationId",
  "m"."sourceType" AS "SourceType",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."errorCount" AS "ErrorCount",
  "m"."pullSchedule" AS "PullSchedule",
  "m"."status" AS "Status",
  "m"."traceProjectId" AS "TraceProjectId",
  "m"."providerAccountId" AS "ProviderAccountId",
  "m"."lastEventAt" AS "LastEventAt",
  "m"."lastSuccessAt" AS "LastSuccessAt",
  "m"."lastReadThroughAt" AS "LastReadThroughAt",
  "m"."lastRunCompleteness" AS "LastRunCompleteness",
  "m"."unpricedUsageSince" AS "UnpricedUsageSince",
  "m"."unpricedUsageThrough" AS "UnpricedUsageThrough",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById"
FROM "public"."IngestionSource" AS "m"
JOIN "public"."Project" AS "p" ON "m"."teamId" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_ingestion_sources";
    CREATE VIEW "public"."lwql_ingestion_sources" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IngestionSourceId",
  "m"."organizationId" AS "OrganizationId",
  "m"."sourceType" AS "SourceType",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."errorCount" AS "ErrorCount",
  "m"."pullSchedule" AS "PullSchedule",
  "m"."status" AS "Status",
  "m"."traceProjectId" AS "TraceProjectId",
  "m"."providerAccountId" AS "ProviderAccountId",
  "m"."lastEventAt" AS "LastEventAt",
  "m"."lastSuccessAt" AS "LastSuccessAt",
  "m"."lastReadThroughAt" AS "LastReadThroughAt",
  "m"."lastRunCompleteness" AS "LastRunCompleteness",
  "m"."unpricedUsageSince" AS "UnpricedUsageSince",
  "m"."unpricedUsageThrough" AS "UnpricedUsageThrough",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById"
FROM "public"."IngestionSource" AS "m"
JOIN "public"."Project" AS "p" ON "m"."teamId" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_ingestion_sources" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 47
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_ingestion_templates" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IngestionTemplateId",
  "m"."slug" AS "Slug",
  "m"."sourceType" AS "SourceType",
  "m"."displayName" AS "DisplayName",
  "m"."description" AS "Description",
  "m"."iconAsset" AS "IconAsset",
  "m"."ottlRules" AS "OttlRules",
  "m"."platformPublished" AS "PlatformPublished",
  "m"."enabled" AS "Enabled",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."IngestionTemplate" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_ingestion_templates";
    CREATE VIEW "public"."lwql_ingestion_templates" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "IngestionTemplateId",
  "m"."slug" AS "Slug",
  "m"."sourceType" AS "SourceType",
  "m"."displayName" AS "DisplayName",
  "m"."description" AS "Description",
  "m"."iconAsset" AS "IconAsset",
  "m"."ottlRules" AS "OttlRules",
  "m"."platformPublished" AS "PlatformPublished",
  "m"."enabled" AS "Enabled",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."IngestionTemplate" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_ingestion_templates" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 48
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_langy_active_turns" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyActiveTurnId",
  "m"."conversationId" AS "ConversationId",
  "m"."turnId" AS "TurnId",
  "m"."requestId" AS "RequestId",
  "m"."userId" AS "UserId",
  "m"."status" AS "Status",
  "m"."leaseOwner" AS "LeaseOwner",
  "m"."leaseExpiresAt" AS "LeaseExpiresAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."LangyActiveTurn" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_langy_active_turns";
    CREATE VIEW "public"."lwql_langy_active_turns" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyActiveTurnId",
  "m"."conversationId" AS "ConversationId",
  "m"."turnId" AS "TurnId",
  "m"."requestId" AS "RequestId",
  "m"."userId" AS "UserId",
  "m"."status" AS "Status",
  "m"."leaseOwner" AS "LeaseOwner",
  "m"."leaseExpiresAt" AS "LeaseExpiresAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."LangyActiveTurn" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_langy_active_turns" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 49
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_langy_conversation_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyConversationProjectionId",
  "m"."conversationId" AS "ConversationId",
  "m"."userId" AS "UserId",
  "m"."title" AS "Title",
  "m"."titleSource" AS "TitleSource",
  "m"."status" AS "Status",
  "m"."isShared" AS "IsShared",
  "m"."sharedAt" AS "SharedAt",
  "m"."sharedById" AS "SharedById",
  "m"."messageCount" AS "MessageCount",
  "m"."lastActivityAt" AS "LastActivityAt",
  "m"."currentTurnId" AS "CurrentTurnId",
  "m"."lastError" AS "LastError",
  "m"."lastModel" AS "LastModel",
  "m"."origin" AS "Origin",
  "m"."pendingHandoffTurnId" AS "PendingHandoffTurnId",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."LangyConversationProjection" AS "m"
WHERE ("m"."isShared" = true);
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_langy_conversation_projections";
    CREATE VIEW "public"."lwql_langy_conversation_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyConversationProjectionId",
  "m"."conversationId" AS "ConversationId",
  "m"."userId" AS "UserId",
  "m"."title" AS "Title",
  "m"."titleSource" AS "TitleSource",
  "m"."status" AS "Status",
  "m"."isShared" AS "IsShared",
  "m"."sharedAt" AS "SharedAt",
  "m"."sharedById" AS "SharedById",
  "m"."messageCount" AS "MessageCount",
  "m"."lastActivityAt" AS "LastActivityAt",
  "m"."currentTurnId" AS "CurrentTurnId",
  "m"."lastError" AS "LastError",
  "m"."lastModel" AS "LastModel",
  "m"."origin" AS "Origin",
  "m"."pendingHandoffTurnId" AS "PendingHandoffTurnId",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."LangyConversationProjection" AS "m"
WHERE ("m"."isShared" = true);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_langy_conversation_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 50
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_langy_conversation_turn_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyConversationTurnProjectionId",
  "m"."conversationId" AS "ConversationId",
  "m"."turnId" AS "TurnId",
  "m"."status" AS "Status",
  "m"."questionParts" AS "QuestionParts",
  "m"."answerParts" AS "AnswerParts",
  "m"."toolCalls" AS "ToolCallsPayload",
  "m"."plan" AS "PlanPayload",
  "m"."error" AS "Error",
  "m"."startedAt" AS "StartedAt",
  "m"."endedAt" AS "EndedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."LangyConversationTurnProjection" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_langy_conversation_turn_projections";
    CREATE VIEW "public"."lwql_langy_conversation_turn_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyConversationTurnProjectionId",
  "m"."conversationId" AS "ConversationId",
  "m"."turnId" AS "TurnId",
  "m"."status" AS "Status",
  "m"."questionParts" AS "QuestionParts",
  "m"."answerParts" AS "AnswerParts",
  "m"."toolCalls" AS "ToolCallsPayload",
  "m"."plan" AS "PlanPayload",
  "m"."error" AS "Error",
  "m"."startedAt" AS "StartedAt",
  "m"."endedAt" AS "EndedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."LangyConversationTurnProjection" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_langy_conversation_turn_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 51
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_langy_message_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyMessageProjectionId",
  "m"."conversationId" AS "ConversationId",
  "m"."messageId" AS "MessageId",
  "m"."role" AS "Role",
  "m"."parts" AS "Parts",
  "m"."sourceEventId" AS "SourceEventId",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."LangyMessageProjection" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_langy_message_projections";
    CREATE VIEW "public"."lwql_langy_message_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyMessageProjectionId",
  "m"."conversationId" AS "ConversationId",
  "m"."messageId" AS "MessageId",
  "m"."role" AS "Role",
  "m"."parts" AS "Parts",
  "m"."sourceEventId" AS "SourceEventId",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."LangyMessageProjection" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_langy_message_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 52
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_langy_turn_requests" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyTurnRequestId",
  "m"."userId" AS "UserId",
  "m"."requestId" AS "RequestId",
  "m"."conversationId" AS "ConversationId",
  "m"."turnId" AS "TurnId",
  "m"."status" AS "Status",
  "m"."leaseOwner" AS "LeaseOwner",
  "m"."leaseExpiresAt" AS "LeaseExpiresAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."LangyTurnRequest" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_langy_turn_requests";
    CREATE VIEW "public"."lwql_langy_turn_requests" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "LangyTurnRequestId",
  "m"."userId" AS "UserId",
  "m"."requestId" AS "RequestId",
  "m"."conversationId" AS "ConversationId",
  "m"."turnId" AS "TurnId",
  "m"."status" AS "Status",
  "m"."leaseOwner" AS "LeaseOwner",
  "m"."leaseExpiresAt" AS "LeaseExpiresAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."LangyTurnRequest" AS "m"
WHERE (EXISTS (
  SELECT 1 FROM "public"."LangyConversationProjection" AS "c"
  WHERE "c"."projectId" = "m"."projectId"
    AND "c"."conversationId" = "m"."conversationId"
    AND "c"."isShared" = true
));
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_langy_turn_requests" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 53
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_model_default_config_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelDefaultConfigScopeId",
  "m"."configId" AS "ConfigId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."ModelDefaultConfigScope" AS "m"
JOIN "public"."ModelDefaultConfig" AS "j0" ON "m"."configId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_model_default_config_scopes";
    CREATE VIEW "public"."lwql_model_default_config_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelDefaultConfigScopeId",
  "m"."configId" AS "ConfigId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."ModelDefaultConfigScope" AS "m"
JOIN "public"."ModelDefaultConfig" AS "j0" ON "m"."configId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_model_default_config_scopes" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 54
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_model_default_configs" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelDefaultConfigId",
  "m"."config" AS "Config",
  "m"."authorId" AS "AuthorId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ModelDefaultConfig" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_model_default_configs";
    CREATE VIEW "public"."lwql_model_default_configs" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelDefaultConfigId",
  "m"."config" AS "Config",
  "m"."authorId" AS "AuthorId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ModelDefaultConfig" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_model_default_configs" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 55
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_model_provider_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelProviderScopeId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."ModelProviderScope" AS "m"
JOIN "public"."ModelProvider" AS "j0" ON "m"."modelProviderId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_model_provider_scopes";
    CREATE VIEW "public"."lwql_model_provider_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelProviderScopeId",
  "m"."modelProviderId" AS "ModelProviderId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."ModelProviderScope" AS "m"
JOIN "public"."ModelProvider" AS "j0" ON "m"."modelProviderId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_model_provider_scopes" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 56
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_model_providers" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelProviderId",
  "m"."name" AS "Name",
  "m"."provider" AS "Provider",
  "m"."routingHandle" AS "RoutingHandle",
  "m"."enabled" AS "Enabled",
  "m"."customModels" AS "CustomModels",
  "m"."customEmbeddingsModels" AS "CustomEmbeddingsModels",
  "m"."deploymentMapping" AS "DeploymentMapping",
  "m"."rateLimitRpm" AS "RateLimitRpm",
  "m"."rateLimitTpm" AS "RateLimitTpm",
  "m"."rateLimitRpd" AS "RateLimitRpd",
  "m"."rotationPolicy" AS "RotationPolicy",
  "m"."providerConfig" AS "ProviderConfig",
  "m"."fallbackPriorityGlobal" AS "FallbackPriorityGlobal",
  "m"."langySkipPermissionsModels" AS "LangySkipPermissionsModels",
  "m"."healthStatus" AS "HealthStatus",
  "m"."circuitOpenedAt" AS "CircuitOpenedAt",
  "m"."lastHealthCheckAt" AS "LastHealthCheckAt",
  "m"."disabledAt" AS "DisabledAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ModelProvider" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_model_providers";
    CREATE VIEW "public"."lwql_model_providers" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "ModelProviderId",
  "m"."name" AS "Name",
  "m"."provider" AS "Provider",
  "m"."routingHandle" AS "RoutingHandle",
  "m"."enabled" AS "Enabled",
  "m"."customModels" AS "CustomModels",
  "m"."customEmbeddingsModels" AS "CustomEmbeddingsModels",
  "m"."deploymentMapping" AS "DeploymentMapping",
  "m"."rateLimitRpm" AS "RateLimitRpm",
  "m"."rateLimitTpm" AS "RateLimitTpm",
  "m"."rateLimitRpd" AS "RateLimitRpd",
  "m"."rotationPolicy" AS "RotationPolicy",
  "m"."providerConfig" AS "ProviderConfig",
  "m"."fallbackPriorityGlobal" AS "FallbackPriorityGlobal",
  "m"."langySkipPermissionsModels" AS "LangySkipPermissionsModels",
  "m"."healthStatus" AS "HealthStatus",
  "m"."circuitOpenedAt" AS "CircuitOpenedAt",
  "m"."lastHealthCheckAt" AS "LastHealthCheckAt",
  "m"."disabledAt" AS "DisabledAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ModelProvider" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_model_providers" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 57
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_monitors" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "MonitorId",
  "m"."experimentId" AS "ExperimentId",
  "m"."evaluatorId" AS "EvaluatorId",
  "m"."checkType" AS "CheckType",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."executionMode" AS "ExecutionMode",
  "m"."enabled" AS "Enabled",
  "m"."preconditions" AS "Preconditions",
  "m"."parameters" AS "Parameters",
  "m"."mappings" AS "Mappings",
  "m"."sample" AS "Sample",
  "m"."level" AS "Level",
  "m"."threadIdleTimeout" AS "ThreadIdleTimeout",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."autoPausedAt" AS "AutoPausedAt",
  "m"."autoPausedReason" AS "AutoPausedReason",
  "m"."evaluatorLabel" AS "EvaluatorLabel",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."Monitor" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_monitors";
    CREATE VIEW "public"."lwql_monitors" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "MonitorId",
  "m"."experimentId" AS "ExperimentId",
  "m"."evaluatorId" AS "EvaluatorId",
  "m"."checkType" AS "CheckType",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."executionMode" AS "ExecutionMode",
  "m"."enabled" AS "Enabled",
  "m"."preconditions" AS "Preconditions",
  "m"."parameters" AS "Parameters",
  "m"."mappings" AS "Mappings",
  "m"."sample" AS "Sample",
  "m"."level" AS "Level",
  "m"."threadIdleTimeout" AS "ThreadIdleTimeout",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."autoPausedAt" AS "AutoPausedAt",
  "m"."autoPausedReason" AS "AutoPausedReason",
  "m"."evaluatorLabel" AS "EvaluatorLabel",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."Monitor" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_monitors" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 58
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_notifications" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "NotificationId",
  "m"."organizationId" AS "OrganizationId",
  "m"."metadata" AS "Metadata",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."sentAt" AS "SentAt"
FROM "public"."Notification" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_notifications";
    CREATE VIEW "public"."lwql_notifications" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "NotificationId",
  "m"."organizationId" AS "OrganizationId",
  "m"."metadata" AS "Metadata",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."sentAt" AS "SentAt"
FROM "public"."Notification" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_notifications" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 59
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_pinned_traces" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PinnedTraceId",
  "m"."traceId" AS "TraceId",
  "m"."userId" AS "UserId",
  "m"."source" AS "Source",
  "m"."reason" AS "Reason",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."PinnedTrace" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_pinned_traces";
    CREATE VIEW "public"."lwql_pinned_traces" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PinnedTraceId",
  "m"."traceId" AS "TraceId",
  "m"."userId" AS "UserId",
  "m"."source" AS "Source",
  "m"."reason" AS "Reason",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."PinnedTrace" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_pinned_traces" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 60
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_process_manager_inboxes" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerInboxId",
  "m"."processName" AS "ProcessName",
  "m"."sourceEventId" AS "SourceEventId",
  "m"."consumedAt" AS "ConsumedAt"
FROM "public"."ProcessManagerInbox" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_process_manager_inboxes";
    CREATE VIEW "public"."lwql_process_manager_inboxes" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerInboxId",
  "m"."processName" AS "ProcessName",
  "m"."sourceEventId" AS "SourceEventId",
  "m"."consumedAt" AS "ConsumedAt"
FROM "public"."ProcessManagerInbox" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_process_manager_inboxes" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 61
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_process_manager_instances" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerInstanceId",
  "m"."processName" AS "ProcessName",
  "m"."userId" AS "UserId",
  "m"."state" AS "State",
  "m"."revision" AS "Revision",
  "m"."nextWakeAt" AS "NextWakeAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ProcessManagerInstance" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_process_manager_instances";
    CREATE VIEW "public"."lwql_process_manager_instances" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerInstanceId",
  "m"."processName" AS "ProcessName",
  "m"."userId" AS "UserId",
  "m"."state" AS "State",
  "m"."revision" AS "Revision",
  "m"."nextWakeAt" AS "NextWakeAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ProcessManagerInstance" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_process_manager_instances" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 62
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_process_manager_outbox_attempts" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerOutboxAttemptId",
  "m"."outboxId" AS "OutboxId",
  "m"."attempt" AS "Attempt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."outcome" AS "Outcome",
  "m"."errorType" AS "ErrorType",
  "m"."errorMessage" AS "ErrorMessage",
  "m"."retryAfterMs" AS "RetryAfterMs"
FROM "public"."ProcessManagerOutboxAttempt" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_process_manager_outbox_attempts";
    CREATE VIEW "public"."lwql_process_manager_outbox_attempts" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerOutboxAttemptId",
  "m"."outboxId" AS "OutboxId",
  "m"."attempt" AS "Attempt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."outcome" AS "Outcome",
  "m"."errorType" AS "ErrorType",
  "m"."errorMessage" AS "ErrorMessage",
  "m"."retryAfterMs" AS "RetryAfterMs"
FROM "public"."ProcessManagerOutboxAttempt" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_process_manager_outbox_attempts" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 63
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_process_manager_outboxes" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerOutboxId",
  "m"."processName" AS "ProcessName",
  "m"."userId" AS "UserId",
  "m"."intentType" AS "IntentType",
  "m"."payload" AS "Payload",
  "m"."traceCarrier" AS "TraceCarrier",
  "m"."sourceEventId" AS "SourceEventId",
  "m"."status" AS "Status",
  "m"."attempts" AS "Attempts",
  "m"."nextAttemptAt" AS "NextAttemptAt",
  "m"."leasedUntil" AS "LeasedUntil",
  "m"."dispatchedAt" AS "DispatchedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ProcessManagerOutbox" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_process_manager_outboxes";
    CREATE VIEW "public"."lwql_process_manager_outboxes" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ProcessManagerOutboxId",
  "m"."processName" AS "ProcessName",
  "m"."userId" AS "UserId",
  "m"."intentType" AS "IntentType",
  "m"."payload" AS "Payload",
  "m"."traceCarrier" AS "TraceCarrier",
  "m"."sourceEventId" AS "SourceEventId",
  "m"."status" AS "Status",
  "m"."attempts" AS "Attempts",
  "m"."nextAttemptAt" AS "NextAttemptAt",
  "m"."leasedUntil" AS "LeasedUntil",
  "m"."dispatchedAt" AS "DispatchedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ProcessManagerOutbox" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_process_manager_outboxes" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 64
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_projects" AS
SELECT
  "m"."id" AS "TenantId",
  "m"."name" AS "ProjectName",
  "m"."slug" AS "ProjectSlug",
  "m"."teamId" AS "TeamId",
  "m"."language" AS "Language",
  "m"."framework" AS "Framework",
  "m"."kind" AS "Kind",
  "m"."firstMessage" AS "FirstMessage",
  "m"."integrated" AS "Integrated",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."userLinkTemplate" AS "UserLinkTemplate",
  "m"."traceSharingEnabled" AS "TraceSharingEnabled",
  "m"."presenceEnabled" AS "PresenceEnabled",
  "m"."s3Endpoint" AS "S3Endpoint",
  "m"."s3Bucket" AS "S3Bucket",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."isPersonal" AS "IsPersonal",
  "m"."ownerUserId" AS "OwnerUserId",
  "m"."personalFeatures" AS "PersonalFeatures",
  "m"."departmentId" AS "DepartmentId",
  "m"."langyEgressAllowlist" AS "LangyEgressAllowlist",
  "m"."lastCodingAgentSessionAt" AS "LastCodingAgentSessionAt",
  "m"."lastCodingAgentPullRequestAt" AS "LastCodingAgentPullRequestAt"
FROM "public"."Project" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_projects";
    CREATE VIEW "public"."lwql_projects" AS
SELECT
  "m"."id" AS "TenantId",
  "m"."name" AS "ProjectName",
  "m"."slug" AS "ProjectSlug",
  "m"."teamId" AS "TeamId",
  "m"."language" AS "Language",
  "m"."framework" AS "Framework",
  "m"."kind" AS "Kind",
  "m"."firstMessage" AS "FirstMessage",
  "m"."integrated" AS "Integrated",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."userLinkTemplate" AS "UserLinkTemplate",
  "m"."traceSharingEnabled" AS "TraceSharingEnabled",
  "m"."presenceEnabled" AS "PresenceEnabled",
  "m"."s3Endpoint" AS "S3Endpoint",
  "m"."s3Bucket" AS "S3Bucket",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."isPersonal" AS "IsPersonal",
  "m"."ownerUserId" AS "OwnerUserId",
  "m"."personalFeatures" AS "PersonalFeatures",
  "m"."departmentId" AS "DepartmentId",
  "m"."langyEgressAllowlist" AS "LangyEgressAllowlist",
  "m"."lastCodingAgentSessionAt" AS "LastCodingAgentSessionAt",
  "m"."lastCodingAgentPullRequestAt" AS "LastCodingAgentPullRequestAt"
FROM "public"."Project" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_projects" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 65
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_prompt_tag_assignments" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PromptTagAssignmentId",
  "m"."configId" AS "ConfigId",
  "m"."versionId" AS "VersionId",
  "m"."tagId" AS "TagId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."PromptTagAssignment" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_prompt_tag_assignments";
    CREATE VIEW "public"."lwql_prompt_tag_assignments" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PromptTagAssignmentId",
  "m"."configId" AS "ConfigId",
  "m"."versionId" AS "VersionId",
  "m"."tagId" AS "TagId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."PromptTagAssignment" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_prompt_tag_assignments" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 66
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_prompt_tags" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "PromptTagId",
  "m"."name" AS "Name",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."PromptTag" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_prompt_tags";
    CREATE VIEW "public"."lwql_prompt_tags" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "PromptTagId",
  "m"."name" AS "Name",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."PromptTag" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_prompt_tags" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 67
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_prompt_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PromptVersionId",
  "m"."version" AS "VersionNumber",
  "m"."commitMessage" AS "CommitMessage",
  "m"."authorId" AS "AuthorId",
  "m"."configId" AS "PromptId",
  "m"."config" AS "ConfigData",
  "m"."schemaVersion" AS "SchemaVersion",
  "m"."runtimeParameters" AS "RuntimeParameters",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."LlmPromptConfigVersion" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_prompt_versions";
    CREATE VIEW "public"."lwql_prompt_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PromptVersionId",
  "m"."version" AS "VersionNumber",
  "m"."commitMessage" AS "CommitMessage",
  "m"."authorId" AS "AuthorId",
  "m"."configId" AS "PromptId",
  "m"."config" AS "ConfigData",
  "m"."schemaVersion" AS "SchemaVersion",
  "m"."runtimeParameters" AS "RuntimeParameters",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."LlmPromptConfigVersion" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_prompt_versions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 68
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_prompts" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PromptId",
  "m"."handle" AS "PromptHandle",
  "m"."name" AS "PromptName",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."deletedAt" AS "DeletedAt",
  "m"."organizationId" AS "OrganizationId",
  "m"."scope" AS "Scope",
  "m"."copiedFromPromptId" AS "CopiedFromPromptId"
FROM "public"."LlmPromptConfig" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_prompts";
    CREATE VIEW "public"."lwql_prompts" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "PromptId",
  "m"."handle" AS "PromptHandle",
  "m"."name" AS "PromptName",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."deletedAt" AS "DeletedAt",
  "m"."organizationId" AS "OrganizationId",
  "m"."scope" AS "Scope",
  "m"."copiedFromPromptId" AS "CopiedFromPromptId"
FROM "public"."LlmPromptConfig" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_prompts" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 69
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_retention_policies" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "RetentionPolicyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."category" AS "Category",
  "m"."retentionDays" AS "RetentionDays",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."RetentionPolicy" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_retention_policies";
    CREATE VIEW "public"."lwql_retention_policies" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "RetentionPolicyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."category" AS "Category",
  "m"."retentionDays" AS "RetentionDays",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."RetentionPolicy" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_retention_policies" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 70
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_routing_policies" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "RoutingPolicyId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."modelProviderIds" AS "ModelProviderIds",
  "m"."modelAliases" AS "ModelAliases",
  "m"."defaultModel" AS "DefaultModel",
  "m"."policyRules" AS "PolicyRules",
  "m"."isDefault" AS "IsDefault",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."RoutingPolicy" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_routing_policies";
    CREATE VIEW "public"."lwql_routing_policies" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "RoutingPolicyId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."modelProviderIds" AS "ModelProviderIds",
  "m"."modelAliases" AS "ModelAliases",
  "m"."defaultModel" AS "DefaultModel",
  "m"."policyRules" AS "PolicyRules",
  "m"."isDefault" AS "IsDefault",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById"
FROM "public"."RoutingPolicy" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_routing_policies" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 71
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_routing_policy_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "RoutingPolicyScopeId",
  "m"."routingPolicyId" AS "RoutingPolicyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."RoutingPolicyScope" AS "m"
JOIN "public"."RoutingPolicy" AS "j0" ON "m"."routingPolicyId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_routing_policy_scopes";
    CREATE VIEW "public"."lwql_routing_policy_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "RoutingPolicyScopeId",
  "m"."routingPolicyId" AS "RoutingPolicyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."RoutingPolicyScope" AS "m"
JOIN "public"."RoutingPolicy" AS "j0" ON "m"."routingPolicyId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_routing_policy_scopes" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 72
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_saved_views" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "SavedViewId",
  "m"."userId" AS "UserId",
  "m"."name" AS "Name",
  "m"."filters" AS "Filters",
  "m"."query" AS "Query",
  "m"."period" AS "Period",
  "m"."order" AS "Order",
  "m"."kind" AS "Kind",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."SavedView" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_saved_views";
    CREATE VIEW "public"."lwql_saved_views" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "SavedViewId",
  "m"."userId" AS "UserId",
  "m"."name" AS "Name",
  "m"."filters" AS "Filters",
  "m"."query" AS "Query",
  "m"."period" AS "Period",
  "m"."order" AS "Order",
  "m"."kind" AS "Kind",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."SavedView" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_saved_views" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 73
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_scenario_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ScenarioVersionId",
  "m"."scenarioId" AS "ScenarioId",
  "m"."version" AS "Version",
  "m"."authorId" AS "AuthorId",
  "m"."authorLabel" AS "AuthorLabel",
  "m"."changeDescription" AS "ChangeDescription",
  "m"."snapshot" AS "Snapshot",
  "m"."schemaVersion" AS "SchemaVersion",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."ScenarioVersion" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_scenario_versions";
    CREATE VIEW "public"."lwql_scenario_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ScenarioVersionId",
  "m"."scenarioId" AS "ScenarioId",
  "m"."version" AS "Version",
  "m"."authorId" AS "AuthorId",
  "m"."authorLabel" AS "AuthorLabel",
  "m"."changeDescription" AS "ChangeDescription",
  "m"."snapshot" AS "Snapshot",
  "m"."schemaVersion" AS "SchemaVersion",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."ScenarioVersion" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_scenario_versions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 74
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_scenarios" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ScenarioId",
  "m"."name" AS "Name",
  "m"."situation" AS "Situation",
  "m"."criteria" AS "Criteria",
  "m"."labels" AS "Labels",
  "m"."parameters" AS "Parameters",
  "m"."simulatorModel" AS "SimulatorModel",
  "m"."judgeModel" AS "JudgeModel",
  "m"."maxTurns" AS "MaxTurns",
  "m"."minTurns" AS "MinTurns",
  "m"."fields" AS "Fields",
  "m"."callerVoice" AS "CallerVoice",
  "m"."testSuiteId" AS "TestSuiteId",
  "m"."version" AS "Version",
  "m"."lastUpdatedById" AS "LastUpdatedById",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Scenario" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_scenarios";
    CREATE VIEW "public"."lwql_scenarios" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ScenarioId",
  "m"."name" AS "Name",
  "m"."situation" AS "Situation",
  "m"."criteria" AS "Criteria",
  "m"."labels" AS "Labels",
  "m"."parameters" AS "Parameters",
  "m"."simulatorModel" AS "SimulatorModel",
  "m"."judgeModel" AS "JudgeModel",
  "m"."maxTurns" AS "MaxTurns",
  "m"."minTurns" AS "MinTurns",
  "m"."fields" AS "Fields",
  "m"."callerVoice" AS "CallerVoice",
  "m"."testSuiteId" AS "TestSuiteId",
  "m"."version" AS "Version",
  "m"."lastUpdatedById" AS "LastUpdatedById",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Scenario" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_scenarios" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 75
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_scheduled_jobs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ScheduledJobId",
  "m"."targetType" AS "TargetType",
  "m"."targetId" AS "TargetId",
  "m"."cron" AS "Cron",
  "m"."timezone" AS "Timezone",
  "m"."nextRunAt" AS "NextRunAt",
  "m"."lastSlot" AS "LastSlot",
  "m"."currentSlot" AS "CurrentSlot",
  "m"."attempts" AS "Attempts",
  "m"."lastError" AS "LastError",
  "m"."active" AS "Active",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ScheduledJob" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_scheduled_jobs";
    CREATE VIEW "public"."lwql_scheduled_jobs" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ScheduledJobId",
  "m"."targetType" AS "TargetType",
  "m"."targetId" AS "TargetId",
  "m"."cron" AS "Cron",
  "m"."timezone" AS "Timezone",
  "m"."nextRunAt" AS "NextRunAt",
  "m"."lastSlot" AS "LastSlot",
  "m"."currentSlot" AS "CurrentSlot",
  "m"."attempts" AS "Attempts",
  "m"."lastError" AS "LastError",
  "m"."active" AS "Active",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ScheduledJob" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_scheduled_jobs" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 76
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_share_links" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ShareLinkId",
  "m"."resourceType" AS "ResourceType",
  "m"."resourceId" AS "ResourceId",
  "m"."threadId" AS "ThreadId",
  "m"."userId" AS "UserId",
  "m"."visibility" AS "Visibility",
  "m"."expiresAt" AS "ExpiresAt",
  "m"."maxViews" AS "MaxViews",
  "m"."viewCount" AS "ViewCount",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ShareLink" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_share_links";
    CREATE VIEW "public"."lwql_share_links" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "ShareLinkId",
  "m"."resourceType" AS "ResourceType",
  "m"."resourceId" AS "ResourceId",
  "m"."threadId" AS "ThreadId",
  "m"."userId" AS "UserId",
  "m"."visibility" AS "Visibility",
  "m"."expiresAt" AS "ExpiresAt",
  "m"."maxViews" AS "MaxViews",
  "m"."viewCount" AS "ViewCount",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."ShareLink" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_share_links" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 77
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_simulation_suites" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "SimulationSuiteId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."description" AS "Description",
  "m"."scenarioIds" AS "ScenarioIds",
  "m"."targets" AS "Targets",
  "m"."repeatCount" AS "RepeatCount",
  "m"."labels" AS "Labels",
  "m"."simulatorModel" AS "SimulatorModel",
  "m"."judgeModel" AS "JudgeModel",
  "m"."kind" AS "Kind",
  "m"."scope" AS "ScopeConfig",
  "m"."fields" AS "Fields",
  "m"."evaluators" AS "Evaluators",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."SimulationSuite" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_simulation_suites";
    CREATE VIEW "public"."lwql_simulation_suites" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "SimulationSuiteId",
  "m"."name" AS "Name",
  "m"."slug" AS "Slug",
  "m"."description" AS "Description",
  "m"."scenarioIds" AS "ScenarioIds",
  "m"."targets" AS "Targets",
  "m"."repeatCount" AS "RepeatCount",
  "m"."labels" AS "Labels",
  "m"."simulatorModel" AS "SimulatorModel",
  "m"."judgeModel" AS "JudgeModel",
  "m"."kind" AS "Kind",
  "m"."scope" AS "ScopeConfig",
  "m"."fields" AS "Fields",
  "m"."evaluators" AS "Evaluators",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."SimulationSuite" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_simulation_suites" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 78
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_topic_clustering_run_history_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicClusteringRunHistoryProjectionId",
  "m"."runs" AS "Runs",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."TopicClusteringRunHistoryProjection" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_topic_clustering_run_history_projections";
    CREATE VIEW "public"."lwql_topic_clustering_run_history_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicClusteringRunHistoryProjectionId",
  "m"."runs" AS "Runs",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."TopicClusteringRunHistoryProjection" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_topic_clustering_run_history_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 79
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_topic_clustering_run_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicClusteringRunProjectionId",
  "m"."lastRequestedAt" AS "LastRequestedAt",
  "m"."lastRequestTrigger" AS "LastRequestTrigger",
  "m"."lastRunAt" AS "LastRunAt",
  "m"."lastRunOutcome" AS "LastRunOutcome",
  "m"."lastRunMode" AS "LastRunMode",
  "m"."lastRunSkippedReason" AS "LastRunSkippedReason",
  "m"."lastRunError" AS "LastRunError",
  "m"."lastRunErrorCode" AS "LastRunErrorCode",
  "m"."lastRunErrorUserActionable" AS "LastRunErrorUserActionable",
  "m"."lastRunTracesProcessed" AS "LastRunTracesProcessed",
  "m"."lastRunTopicsCount" AS "LastRunTopicsCount",
  "m"."lastRunSubtopicsCount" AS "LastRunSubtopicsCount",
  "m"."lastRunPages" AS "LastRunPages",
  "m"."inProgressRunId" AS "InProgressRunId",
  "m"."inProgressTraces" AS "InProgressTraces",
  "m"."inProgressPages" AS "InProgressPages",
  "m"."inProgressStartedAt" AS "InProgressStartedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."TopicClusteringRunProjection" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_topic_clustering_run_projections";
    CREATE VIEW "public"."lwql_topic_clustering_run_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicClusteringRunProjectionId",
  "m"."lastRequestedAt" AS "LastRequestedAt",
  "m"."lastRequestTrigger" AS "LastRequestTrigger",
  "m"."lastRunAt" AS "LastRunAt",
  "m"."lastRunOutcome" AS "LastRunOutcome",
  "m"."lastRunMode" AS "LastRunMode",
  "m"."lastRunSkippedReason" AS "LastRunSkippedReason",
  "m"."lastRunError" AS "LastRunError",
  "m"."lastRunErrorCode" AS "LastRunErrorCode",
  "m"."lastRunErrorUserActionable" AS "LastRunErrorUserActionable",
  "m"."lastRunTracesProcessed" AS "LastRunTracesProcessed",
  "m"."lastRunTopicsCount" AS "LastRunTopicsCount",
  "m"."lastRunSubtopicsCount" AS "LastRunSubtopicsCount",
  "m"."lastRunPages" AS "LastRunPages",
  "m"."inProgressRunId" AS "InProgressRunId",
  "m"."inProgressTraces" AS "InProgressTraces",
  "m"."inProgressPages" AS "InProgressPages",
  "m"."inProgressStartedAt" AS "InProgressStartedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."TopicClusteringRunProjection" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_topic_clustering_run_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 80
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_topic_model_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicModelProjectionId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."TopicModelProjection" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_topic_model_projections";
    CREATE VIEW "public"."lwql_topic_model_projections" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicModelProjectionId",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."occurredAt" AS "OccurredAt",
  "m"."acceptedAt" AS "AcceptedAt",
  "m"."lastEventId" AS "LastEventId",
  "m"."projectionVersion" AS "ProjectionVersion"
FROM "public"."TopicModelProjection" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_topic_model_projections" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 81
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_topics" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicId",
  "m"."name" AS "TopicName",
  "m"."parentId" AS "ParentTopicId",
  "m"."automaticallyGenerated" AS "AutomaticallyGenerated",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Topic" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_topics";
    CREATE VIEW "public"."lwql_topics" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TopicId",
  "m"."name" AS "TopicName",
  "m"."parentId" AS "ParentTopicId",
  "m"."automaticallyGenerated" AS "AutomaticallyGenerated",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."Topic" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_topics" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 82
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_trace_edit_overlays" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TraceEditOverlayId",
  "m"."traceId" AS "TraceId",
  "m"."patch" AS "Patch",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."TraceEditOverlay" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_trace_edit_overlays";
    CREATE VIEW "public"."lwql_trace_edit_overlays" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TraceEditOverlayId",
  "m"."traceId" AS "TraceId",
  "m"."patch" AS "Patch",
  "m"."createdById" AS "CreatedById",
  "m"."updatedById" AS "UpdatedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."TraceEditOverlay" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_trace_edit_overlays" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 83
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_trigger_sents" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TriggerSentId",
  "m"."triggerId" AS "TriggerId",
  "m"."traceId" AS "TraceId",
  "m"."customGraphId" AS "CustomGraphId",
  "m"."resolvedAt" AS "ResolvedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."TriggerSent" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_trigger_sents";
    CREATE VIEW "public"."lwql_trigger_sents" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TriggerSentId",
  "m"."triggerId" AS "TriggerId",
  "m"."traceId" AS "TraceId",
  "m"."customGraphId" AS "CustomGraphId",
  "m"."resolvedAt" AS "ResolvedAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt"
FROM "public"."TriggerSent" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_trigger_sents" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 84
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_triggers" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TriggerId",
  "m"."name" AS "Name",
  "m"."action" AS "Action",
  "m"."triggerKind" AS "TriggerKind",
  "m"."filters" AS "Filters",
  "m"."filterQuery" AS "FilterQuery",
  "m"."lastRunAt" AS "LastRunAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."active" AS "Active",
  "m"."pausedReason" AS "PausedReason",
  "m"."pausedAt" AS "PausedAt",
  "m"."message" AS "Message",
  "m"."deleted" AS "Deleted",
  "m"."alertType" AS "AlertType",
  "m"."slackTemplateType" AS "SlackTemplateType",
  "m"."slackTemplate" AS "SlackTemplate",
  "m"."notificationCadence" AS "NotificationCadence",
  "m"."traceDebounceMs" AS "TraceDebounceMs",
  "m"."customGraphId" AS "CustomGraphId"
FROM "public"."Trigger" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_triggers";
    CREATE VIEW "public"."lwql_triggers" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "TriggerId",
  "m"."name" AS "Name",
  "m"."action" AS "Action",
  "m"."triggerKind" AS "TriggerKind",
  "m"."filters" AS "Filters",
  "m"."filterQuery" AS "FilterQuery",
  "m"."lastRunAt" AS "LastRunAt",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."active" AS "Active",
  "m"."pausedReason" AS "PausedReason",
  "m"."pausedAt" AS "PausedAt",
  "m"."message" AS "Message",
  "m"."deleted" AS "Deleted",
  "m"."alertType" AS "AlertType",
  "m"."slackTemplateType" AS "SlackTemplateType",
  "m"."slackTemplate" AS "SlackTemplate",
  "m"."notificationCadence" AS "NotificationCadence",
  "m"."traceDebounceMs" AS "TraceDebounceMs",
  "m"."customGraphId" AS "CustomGraphId"
FROM "public"."Trigger" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_triggers" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 85
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_virtual_key_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "VirtualKeyScopeId",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."VirtualKeyScope" AS "m"
JOIN "public"."VirtualKey" AS "j0" ON "m"."virtualKeyId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_virtual_key_scopes";
    CREATE VIEW "public"."lwql_virtual_key_scopes" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "VirtualKeyScopeId",
  "m"."virtualKeyId" AS "VirtualKeyId",
  "m"."scopeType" AS "ScopeType",
  "m"."scopeId" AS "ScopeId",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."VirtualKeyScope" AS "m"
JOIN "public"."VirtualKey" AS "j0" ON "m"."virtualKeyId" = "j0"."id"
JOIN "public"."Team" AS "t" ON "j0"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_virtual_key_scopes" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 86
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_virtual_keys" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "VirtualKeyId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."status" AS "Status",
  "m"."purpose" AS "Purpose",
  "m"."externalId" AS "ExternalId",
  "m"."metadata" AS "Metadata",
  "m"."disabledAt" AS "DisabledAt",
  "m"."disabledReason" AS "DisabledReason",
  "m"."expiresAt" AS "ExpiresAt",
  "m"."displayPrefix" AS "DisplayPrefix",
  "m"."principalUserId" AS "PrincipalUserId",
  "m"."traceProjectId" AS "TraceProjectId",
  "m"."config" AS "Config",
  "m"."revision" AS "Revision",
  "m"."revokedAt" AS "RevokedAt",
  "m"."revokedById" AS "RevokedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."lastUsedAt" AS "LastUsedAt",
  "m"."routingPolicyId" AS "RoutingPolicyId",
  "m"."routingMode" AS "RoutingMode",
  "m"."connectServices" AS "ConnectServices",
  "m"."licenseInstanceId" AS "LicenseInstanceId",
  "m"."licenseExpiresAt" AS "LicenseExpiresAt"
FROM "public"."VirtualKey" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_virtual_keys";
    CREATE VIEW "public"."lwql_virtual_keys" AS
SELECT
  "p"."id" AS "TenantId",
  "m"."id" AS "VirtualKeyId",
  "m"."name" AS "Name",
  "m"."description" AS "Description",
  "m"."status" AS "Status",
  "m"."purpose" AS "Purpose",
  "m"."externalId" AS "ExternalId",
  "m"."metadata" AS "Metadata",
  "m"."disabledAt" AS "DisabledAt",
  "m"."disabledReason" AS "DisabledReason",
  "m"."expiresAt" AS "ExpiresAt",
  "m"."displayPrefix" AS "DisplayPrefix",
  "m"."principalUserId" AS "PrincipalUserId",
  "m"."traceProjectId" AS "TraceProjectId",
  "m"."config" AS "Config",
  "m"."revision" AS "Revision",
  "m"."revokedAt" AS "RevokedAt",
  "m"."revokedById" AS "RevokedById",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."createdById" AS "CreatedById",
  "m"."lastUsedAt" AS "LastUsedAt",
  "m"."routingPolicyId" AS "RoutingPolicyId",
  "m"."routingMode" AS "RoutingMode",
  "m"."connectServices" AS "ConnectServices",
  "m"."licenseInstanceId" AS "LicenseInstanceId",
  "m"."licenseExpiresAt" AS "LicenseExpiresAt"
FROM "public"."VirtualKey" AS "m"
JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"
JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_virtual_keys" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 87
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_webhook_endpoint_deliveries" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "WebhookEndpointDeliveryId",
  "m"."channel" AS "Channel",
  "m"."organizationId" AS "OrganizationId",
  "m"."endpointId" AS "EndpointId",
  "m"."triggerId" AS "TriggerId",
  "m"."dispatchId" AS "DispatchId",
  "m"."attempt" AS "Attempt",
  "m"."eventCount" AS "EventCount",
  "m"."responseStatus" AS "ResponseStatus",
  "m"."latencyMs" AS "LatencyMs",
  "m"."error" AS "Error",
  "m"."response" AS "Response",
  "m"."outcome" AS "Outcome",
  "m"."firedAt" AS "FiredAt",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."WebhookEndpointDelivery" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_webhook_endpoint_deliveries";
    CREATE VIEW "public"."lwql_webhook_endpoint_deliveries" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "WebhookEndpointDeliveryId",
  "m"."channel" AS "Channel",
  "m"."organizationId" AS "OrganizationId",
  "m"."endpointId" AS "EndpointId",
  "m"."triggerId" AS "TriggerId",
  "m"."dispatchId" AS "DispatchId",
  "m"."attempt" AS "Attempt",
  "m"."eventCount" AS "EventCount",
  "m"."responseStatus" AS "ResponseStatus",
  "m"."latencyMs" AS "LatencyMs",
  "m"."error" AS "Error",
  "m"."response" AS "Response",
  "m"."outcome" AS "Outcome",
  "m"."firedAt" AS "FiredAt",
  "m"."createdAt" AS "CreatedAt"
FROM "public"."WebhookEndpointDelivery" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_webhook_endpoint_deliveries" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 88
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_workflow_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "WorkflowVersionId",
  "m"."version" AS "Version",
  "m"."commitMessage" AS "CommitMessage",
  "m"."authorId" AS "AuthorId",
  "m"."workflowId" AS "WorkflowId",
  "m"."parentId" AS "ParentId",
  "m"."autoSaved" AS "AutoSaved",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."dsl" AS "Dsl"
FROM "public"."WorkflowVersion" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_workflow_versions";
    CREATE VIEW "public"."lwql_workflow_versions" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "WorkflowVersionId",
  "m"."version" AS "Version",
  "m"."commitMessage" AS "CommitMessage",
  "m"."authorId" AS "AuthorId",
  "m"."workflowId" AS "WorkflowId",
  "m"."parentId" AS "ParentId",
  "m"."autoSaved" AS "AutoSaved",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."dsl" AS "Dsl"
FROM "public"."WorkflowVersion" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_workflow_versions" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 89
DO $lwql$
BEGIN
  CREATE OR REPLACE VIEW "public"."lwql_workflows" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "WorkflowId",
  "m"."name" AS "Name",
  "m"."icon" AS "Icon",
  "m"."description" AS "Description",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."latestVersionId" AS "LatestVersionId",
  "m"."currentVersionId" AS "CurrentVersionId",
  "m"."publishedId" AS "PublishedId",
  "m"."publishedById" AS "PublishedById",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."isEvaluator" AS "IsEvaluator",
  "m"."isComponent" AS "IsComponent",
  "m"."copiedFromWorkflowId" AS "CopiedFromWorkflowId"
FROM "public"."Workflow" AS "m";
EXCEPTION
  WHEN feature_not_supported OR invalid_table_definition THEN
    DROP VIEW IF EXISTS "public"."lwql_workflows";
    CREATE VIEW "public"."lwql_workflows" AS
SELECT
  "m"."projectId" AS "TenantId",
  "m"."id" AS "WorkflowId",
  "m"."name" AS "Name",
  "m"."icon" AS "Icon",
  "m"."description" AS "Description",
  "m"."createdAt" AS "CreatedAt",
  "m"."updatedAt" AS "UpdatedAt",
  "m"."latestVersionId" AS "LatestVersionId",
  "m"."currentVersionId" AS "CurrentVersionId",
  "m"."publishedId" AS "PublishedId",
  "m"."publishedById" AS "PublishedById",
  "m"."archivedAt" AS "ArchivedAt",
  "m"."isEvaluator" AS "IsEvaluator",
  "m"."isComponent" AS "IsComponent",
  "m"."copiedFromWorkflowId" AS "CopiedFromWorkflowId"
FROM "public"."Workflow" AS "m";
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
      GRANT SELECT ON "public"."lwql_workflows" TO "lwql_ro";
    END IF;
END
$lwql$

-- statement 90
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN
    EXECUTE 'CREATE ROLE "lwql_ro" LOGIN';
  END IF;
END
$$

-- statement 91
ALTER ROLE "lwql_ro" WITH LOGIN PASSWORD 'scope-test-pw' CONNECTION LIMIT 5

-- statement 92
ALTER ROLE "lwql_ro" SET default_transaction_read_only = on

-- statement 93
ALTER ROLE "lwql_ro" SET statement_timeout = '10s'

-- statement 94
DO $lwql_grants$
BEGIN
  REVOKE ALL ON SCHEMA "public" FROM "lwql_ro";
  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "lwql_ro";
  GRANT USAGE ON SCHEMA "public" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_agents" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_ai_tool_entries" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_ai_tool_entry_departments" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_ai_tool_entry_teams" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_analytics" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_annotation_queue_items" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_annotation_queue_scores" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_annotation_queues" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_annotation_scores" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_annotations" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_anomaly_alerts" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_anomaly_rules" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_batch_evaluations" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_costs" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_custom_graphs" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_custom_llm_model_costs" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_dashboard_widgets" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_dashboards" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_dashboards_v2" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_data_privacy_policies" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_dataset_records" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_datasets" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_department_membership_histories" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_departments" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_discovered_agents" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_discovered_persons" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_email_suppressions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_erased_identifier_suppressions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_evaluators" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_experiment_versions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_experiments" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_budget_bucket_boundaries" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_budget_ledgers" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_budgets" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_cache_rules" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_change_events" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_guardrails" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_gateway_realtime_sessions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_github_branch_pull_request_checks" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_github_installations" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_github_pull_requests" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_governance_tenant_histories" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_identity_match_suggestions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_identity_matches" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_ingestion_pull_run_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_ingestion_sources" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_ingestion_templates" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_langy_active_turns" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_langy_conversation_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_langy_conversation_turn_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_langy_message_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_langy_turn_requests" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_model_default_config_scopes" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_model_default_configs" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_model_provider_scopes" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_model_providers" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_monitors" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_notifications" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_pinned_traces" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_process_manager_inboxes" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_process_manager_instances" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_process_manager_outbox_attempts" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_process_manager_outboxes" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_projects" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_prompt_tag_assignments" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_prompt_tags" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_prompt_versions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_prompts" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_retention_policies" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_routing_policies" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_routing_policy_scopes" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_saved_views" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_scenario_versions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_scenarios" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_scheduled_jobs" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_share_links" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_simulation_suites" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_topic_clustering_run_history_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_topic_clustering_run_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_topic_model_projections" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_topics" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_trace_edit_overlays" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_trigger_sents" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_triggers" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_virtual_key_scopes" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_virtual_keys" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_webhook_endpoint_deliveries" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_workflow_versions" TO "lwql_ro";
  GRANT SELECT ON "public"."lwql_workflows" TO "lwql_ro";
END
$lwql_grants$
