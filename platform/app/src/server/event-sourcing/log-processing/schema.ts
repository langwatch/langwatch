import { z } from "zod";

/**
 * One log line, post-policy: structure intact, scopes distinct, severity
 * carrying both its number and its text
 * (specs/otlp/canonical-log-ingestion.feature). `recordId` is a content hash of
 * everything below except itself, so two deliveries of the same wire record
 * always produce the same row.
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
  /** Always "": classifying by coding-agent span kind is that pipeline's job. */
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
