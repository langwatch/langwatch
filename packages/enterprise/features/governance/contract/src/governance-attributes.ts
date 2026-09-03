import { z } from "zod";

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

export function isGovernanceOriginTrace(
  attributes: Record<string, string> | undefined,
): boolean {
  return attributes?.[GOVERNANCE_ATTR.ORIGIN_KIND] === GOVERNANCE_ORIGIN_KIND_VALUE;
}
