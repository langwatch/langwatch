import { z } from "zod";

export const GOVERNANCE_INGESTION_SOURCE_TYPES = [
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "workato",
  "copilot_studio",
  "copilot_studio_dataverse",
  "openai_compliance",
  "openai_admin",
  "claude_compliance",
  "anthropic_admin",
  "databricks_genie",
  "s3_custom",
  "http_custom",
] as const;
export const governanceIngestionSourceTypeSchema = z.enum(GOVERNANCE_INGESTION_SOURCE_TYPES);
export type GovernanceIngestionSourceType = z.infer<typeof governanceIngestionSourceTypeSchema>;

/**
 * The source types that receive inbound pushes, and therefore the only ones
 * that have an ingest secret at all.
 *
 * A pull-mode or pure-S3 source authenticates OUTBOUND — it dials the vendor
 * with the vendor's own credential and is never dialled back — so an `lw_is_*`
 * secret minted for one was generated, hashed, stored and shown in a modal
 * without ever authenticating anything. `s3_custom` is the exception, because
 * it is told about new objects over the webhook callback path, and that path
 * is authenticated by the ingest secret.
 *
 * The browser's own catalogue carries the same classification as
 * `needsIngestSecret`, because a React bundle may not import this package's
 * server half; `pushSourceTypeParity.unit.test.ts` is what keeps the two in
 * step.
 */
const PUSH_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "otel_generic",
  "claude_code",
  "claude_cowork",
  "workato",
  // The webhook callback path, authenticated by the ingest secret.
  "s3_custom",
]);

export function isPushSourceType({ sourceType }: { sourceType: string }): boolean {
  return PUSH_SOURCE_TYPES.has(sourceType);
}

export const governanceIngestionSourceSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    teamId: z.string().nullable(),
    traceProjectId: z.string().nullable().optional(),
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
    traceProjectId: z.string().nullable().optional(),
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
    traceProjectId: z.string().nullable().optional(),
    pullSchedule: z.string().nullable().optional(),
  })
  .strict();
export type UpdateGovernanceIngestionSourceCommand = z.infer<
  typeof updateGovernanceIngestionSourceCommandSchema
>;

export const createdGovernanceIngestionSourceSchema = z
  .object({
    source: governanceIngestionSourceSchema,
    /**
     * The raw secret, exposed exactly once at creation and never persisted.
     * Null for a source type that receives no inbound push and therefore has
     * no secret to expose — see {@link isPushSourceType}.
     */
    ingestSecret: z.string().nullable(),
  })
  .strict();
export type CreatedGovernanceIngestionSource = z.infer<
  typeof createdGovernanceIngestionSourceSchema
>;
