import { z } from "zod";

/**
 * The canonical log record's shape (specs/otlp/canonical-log-ingestion.feature).
 *
 * One log line, post-policy: structure intact (a structured body stays
 * structured, never flattened to a string), scopes distinct (resource, scope
 * and record attributes never merge), severity carrying both its number and
 * its text. `recordId` is a content hash of everything below except itself, so
 * two deliveries of the same wire record always produce the same row
 * (`aggregate.ts`'s aggregate id, and the redelivery story in `store.ts`).
 *
 * This is a straight carry-over of the old pipeline's
 * `schemas/logRecord.ts:canonicalLogRecordSchema` — ADR-105 replaces the
 * *ceremony* around an event (four declaration sites, a `typeGuards.ts`, a
 * `z.infer` alias file), not the row shape a log record actually needs. The
 * row shape is domain content, and domain content does not get thinner just
 * because the declaration mechanism around it changed.
 */

const logCorrelationSourceSchema = z.enum([
  "none",
  "wire",
  "claude_synthesized",
  "codex_synthesized",
]);
export type LogCorrelationSource = z.infer<typeof logCorrelationSourceSchema>;

const logProviderKindSchema = z.enum(["generic", "claude_code", "codex"]);
export type LogProviderKind = z.infer<typeof logProviderKindSchema>;

/**
 * Declared locally rather than imported from the (not yet converted)
 * trace-processing pipeline. ADR-102 decision 5: a pipeline's dependencies
 * point downward, to `@langwatch/event-sourcing` and to another *converted*
 * pipeline's `commands/`/`schemas/` — never sideways into a pipeline still
 * living in `event-sourcing.old/`. Once trace-processing converts and needs
 * the same enum, this collapses into whatever shared home that conversion
 * gives it; duplicating a three-value enum is a smaller cost than a
 * dependency on code scheduled for deletion.
 */
export const piiRedactionLevelSchema = z.enum([
  "STRICT",
  "ESSENTIAL",
  "DISABLED",
]);
export type PIIRedactionLevel = z.infer<typeof piiRedactionLevelSchema>;

export const canonicalLogRecordSchema = z.object({
  tenantId: z.string(),
  organizationId: z.string(),
  recordId: z.string().regex(/^[a-f0-9]{64}$/),

  resourceSchemaUrl: z.string(),
  resourceAttributesJson: z.string(),
  resourceAttributesFlatJson: z.string(),
  resourceAttributeKeys: z.array(z.string()),
  resourceDroppedAttributesCount: z.number().int().nonnegative(),

  scopeSchemaUrl: z.string(),
  scopeName: z.string(),
  scopeVersion: z.string(),
  scopeAttributesJson: z.string(),
  scopeAttributeKeys: z.array(z.string()),
  scopeDroppedAttributesCount: z.number().int().nonnegative(),

  wireTraceId: z.string(),
  wireSpanId: z.string(),
  correlationTraceId: z.string(),
  correlationSpanId: z.string(),
  correlationSource: logCorrelationSourceSchema,

  timeUnixNano: z.string().regex(/^\d+$/),
  observedTimeUnixNano: z.string().regex(/^\d+$/),
  timeUnixMs: z.number().int().nonnegative(),
  severityNumber: z.number().int().min(0).max(255),
  severityText: z.string(),
  bodyType: z.enum([
    "empty",
    "string",
    "bool",
    "int",
    "double",
    "bytes",
    "array",
    "kvlist",
  ]),
  bodyJson: z.string(),
  bodyText: z.string().nullable(),

  attributesJson: z.string(),
  attributesFlatJson: z.string(),
  attributeKeys: z.array(z.string()),
  droppedAttributesCount: z.number().int().nonnegative(),
  flags: z.number().int().nonnegative(),
  eventName: z.string(),
  providerKind: logProviderKindSchema,
  /**
   * Deliberately always "". This once carried the claude span-kind
   * (model/tool/turn) that a log-to-span converter classified logs by; that
   * converter belongs to the coding-agent pipeline's own normalization now,
   * not to the generic log pipeline. The column stays because the deployed
   * `log_records` table has it (migration `00050`); this pipeline never
   * populates it.
   */
  providerEventKind: z.string(),
  providerEventSequence: z.string(),
  providerSessionId: z.string(),
  providerConversationId: z.string(),
  providerPromptId: z.string(),
  piiRedactionLevel: piiRedactionLevelSchema,

  canonicalPayload: z.string(),
  canonicalSizeBytes: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  acceptedAt: z.number().int().nonnegative(),
});

export type CanonicalLogRecord = z.infer<typeof canonicalLogRecordSchema>;
