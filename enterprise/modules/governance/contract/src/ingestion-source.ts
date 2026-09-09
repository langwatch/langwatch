import { z } from "zod";

export const OTTL_ENABLED_SOURCE_TYPES = ["otel_generic"] as const;
export const ottlEnabledSourceTypeSchema = z.enum(OTTL_ENABLED_SOURCE_TYPES);
export type OttlEnabledSourceType = z.infer<typeof ottlEnabledSourceTypeSchema>;

/**
 * Platform-known tools use native extractors. Only the generic OTLP source
 * exposes the custom OTTL editor, and it deliberately starts empty.
 */
export function getStarterTemplate(_sourceType: string): readonly string[] {
  return [];
}

export function isOttlEnabledSourceType(sourceType: string): sourceType is OttlEnabledSourceType {
  return ottlEnabledSourceTypeSchema.safeParse(sourceType).success;
}

/**
 * One configured source, as the admin surface reads it.
 *
 * Deliberately NOT the stored row: the secret hash, the private rotation slot
 * and the sealed credentials envelope never travel, and `parserConfig` is
 * filtered to the keys that are not one of those. Writing the wire shape down
 * is what keeps a later `select` widening from quietly putting one back.
 */
export const ingestionSourceDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    teamId: z.string().nullable(),
    sourceType: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    parserConfig: z.record(z.string(), z.unknown()),
    hasPollerCursor: z.boolean(),
    pullSchedule: z.string().nullable(),
    status: z.string(),
    traceProjectId: z.string().nullable(),
    /** The destination it points at is gone: archived, deleted, or never ours. */
    traceProjectArchived: z.boolean(),
    lastEventAt: z.date().nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    createdById: z.string().nullable(),
  })
  .strict();
export type IngestionSourceDto = z.infer<typeof ingestionSourceDtoSchema>;

/**
 * A source plus its ingest secret — the one moment the plaintext exists on the
 * wire. Answered by a create and by a rotation, and by nothing else.
 */
export const ingestionSourceWithSecretSchema = z
  .object({ source: ingestionSourceDtoSchema, ingestSecret: z.string() })
  .strict();

/**
 * The canonical OTTL starter statements for a source type, and whether OTTL
 * editing is offered for it at all.
 */
export const ottlStarterTemplateSchema = z
  .object({
    enabled: z.boolean(),
    statements: z.array(z.string()),
    enabledSourceTypes: z.array(z.string()),
  })
  .strict();
