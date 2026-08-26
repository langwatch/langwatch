import { z } from "zod";

export const GOVERNANCE_INGESTION_SOURCE_TYPES = [
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
export const governanceIngestionSourceTypeSchema = z.enum(
  GOVERNANCE_INGESTION_SOURCE_TYPES,
);
export type GovernanceIngestionSourceType = z.infer<
  typeof governanceIngestionSourceTypeSchema
>;

export const governanceIngestionSourceSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    teamId: z.string().nullable(),
    sourceType: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    ingestSecretHash: z.string(),
    parserConfig: z.record(z.string(), z.unknown()),
    pollerCursor: z.unknown().nullable(),
    errorCount: z.number().int().nonnegative(),
    pullSchedule: z.string().nullable(),
    status: z.string(),
    lastEventAt: z.date().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    createdById: z.string().nullable(),
  })
  .strict();
export type GovernanceIngestionSource = z.infer<typeof governanceIngestionSourceSchema>;

export const createGovernanceIngestionSourceCommandSchema = z
  .object({
    organizationId: z.string().min(1),
    teamId: z.string().nullable().optional(),
    sourceType: governanceIngestionSourceTypeSchema,
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    parserConfig: z.record(z.string(), z.unknown()).optional(),
    pullConfig: z.record(z.string(), z.unknown()).nullable().optional(),
    pullSchedule: z.string().nullable().optional(),
    actorUserId: z.string().min(1),
  })
  .strict();
export type CreateGovernanceIngestionSourceCommand = z.infer<
  typeof createGovernanceIngestionSourceCommandSchema
>;

export const updateGovernanceIngestionSourceCommandSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    parserConfig: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(["active", "disabled", "awaiting_first_event"]).optional(),
    teamId: z.string().nullable().optional(),
    pullSchedule: z.string().nullable().optional(),
  })
  .strict();
export type UpdateGovernanceIngestionSourceCommand = z.infer<
  typeof updateGovernanceIngestionSourceCommandSchema
>;

export const createdGovernanceIngestionSourceSchema = z
  .object({
    source: governanceIngestionSourceSchema,
    ingestSecret: z.string(),
  })
  .strict();
export type CreatedGovernanceIngestionSource = z.infer<
  typeof createdGovernanceIngestionSourceSchema
>;
