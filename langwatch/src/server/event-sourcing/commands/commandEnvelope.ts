import { z } from "zod";

/**
 * Envelope fields present on all command payloads.
 * These are stripped before being stored as event data.
 */
export const commandEnvelopeSchema = z.object({
  tenantId: z.string(),
  occurredAt: z.number(),
  idempotencyKey: z.string().optional(),
});

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

/**
 * Merges envelope fields into an event data schema to derive the full command data schema.
 * Event data schemas are the source of truth; command schemas add tenantId, occurredAt,
 * and optional idempotencyKey.
 */
export function withCommandEnvelope<T extends z.ZodRawShape>(
  eventDataSchema: z.ZodObject<T>,
) {
  return commandEnvelopeSchema.merge(eventDataSchema);
}

/**
 * Strips envelope fields from command data to produce event data.
 * Used by defineCommand to map command payloads to event data automatically.
 */
export function stripEnvelope<T extends CommandEnvelope>(
  data: T,
): Omit<T, keyof CommandEnvelope> {
  const { tenantId, occurredAt, idempotencyKey, ...eventData } = data;
  return eventData as Omit<T, keyof CommandEnvelope>;
}
