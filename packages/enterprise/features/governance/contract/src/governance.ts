import { z } from "zod";

export const GOVERNANCE_FEATURE_ID = "governance" as const;

export const GOVERNANCE_SOURCE_TYPES = [
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "workato",
  "copilot_studio",
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

export const governanceEventEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    aggregateId: z.string().min(1),
    aggregateType: z.string().min(1),
    tenantId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    occurredAt: z.number().int().nonnegative(),
    type: z.string().min(1),
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    data: z.unknown(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .strict();
