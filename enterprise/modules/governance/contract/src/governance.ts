import type { Named } from "@langwatch/module";
import { z } from "zod";

export const GOVERNANCE_FEATURE_ID = "governance" as const;

export const GOVERNANCE_SOURCE_TYPES = [
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "workato",
  "copilot_studio",
  "copilot_studio_dataverse",
  "openai_admin",
  "openai_compliance",
  "claude_compliance",
  "anthropic_admin",
  "databricks_genie",
  "s3_custom",
  "http_custom",
] as const;

export const NON_ENTERPRISE_INGESTION_SOURCE_CAP = 3 as const;

export const governanceSourceTypeSchema = z.enum(GOVERNANCE_SOURCE_TYPES);
export type GovernanceSourceType = z.infer<typeof governanceSourceTypeSchema>;

const governanceEventEnvelopeSchemaDefinition = z
  .object({
    id: z.string().min(1),
    aggregateId: z.string().min(1),
    aggregateType: z.string().min(1),
    tenantId: z.string().min(1).brand<"TenantId">(),
    createdAt: z.number().int().nonnegative(),
    occurredAt: z.number().int().nonnegative(),
    type: z.string().min(1),
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data: z.unknown(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();
export interface GovernanceEventEnvelopeSchema extends Named<
  typeof governanceEventEnvelopeSchemaDefinition
> {}
export const governanceEventEnvelopeSchema: GovernanceEventEnvelopeSchema =
  governanceEventEnvelopeSchemaDefinition;

const governanceSetupStateSchemaDefinition = z
  .object({
    hasPersonalVKs: z.boolean(),
    hasRoutingPolicies: z.boolean(),
    hasIngestionSources: z.boolean(),
    hasAnomalyRules: z.boolean(),
    hasRecentActivity: z.boolean(),
    hasApplicationTraces: z.boolean(),
    governanceActive: z.boolean(),
  })
  .strict();
export interface GovernanceSetupStateSchema extends Named<
  typeof governanceSetupStateSchemaDefinition
> {}
export const governanceSetupStateSchema: GovernanceSetupStateSchema =
  governanceSetupStateSchemaDefinition;
export type GovernanceSetupState = z.infer<typeof governanceSetupStateSchema>;

export const GOVERNANCE_ORIGIN_KIND_VALUE = "ingestion_source" as const;
export const GOVERNANCE_ATTR = {
  ORIGIN_KIND: "langwatch.origin.kind",
  INGESTION_SOURCE_ID: "langwatch.ingestion_source.id",
  INGESTION_SOURCE_TYPE: "langwatch.ingestion_source.source_type",
  INGESTION_SOURCE_ORG_ID: "langwatch.ingestion_source.organization_id",
  USER_ID: "langwatch.user_id",
  ANOMALY_ALERT_ID: "langwatch.governance.anomaly_alert_id",
} as const;
export const governanceAttributeKeySchema = z.enum(GOVERNANCE_ATTR);
export type GovernanceAttributeKey = z.infer<typeof governanceAttributeKeySchema>;
export type GovernanceAttrKey = GovernanceAttributeKey;

export function isGovernanceOriginTrace(attributes: Record<string, string> | undefined): boolean {
  return attributes?.[GOVERNANCE_ATTR.ORIGIN_KIND] === GOVERNANCE_ORIGIN_KIND_VALUE;
}
