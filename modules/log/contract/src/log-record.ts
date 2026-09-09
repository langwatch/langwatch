import { z } from "zod";

export const logCorrelationSourceSchema = z.enum([
  "none",
  "wire",
  "claude_synthesized",
  "codex_synthesized",
]);
export type LogCorrelationSource = z.infer<typeof logCorrelationSourceSchema>;

export const logProviderKindSchema = z.enum(["generic", "claude_code", "codex"]);
export type LogProviderKind = z.infer<typeof logProviderKindSchema>;

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
  bodyType: z.enum(["empty", "string", "bool", "int", "double", "bytes", "array", "kvlist"]),
  bodyJson: z.string(),
  bodyText: z.string().nullable(),
  attributesJson: z.string(),
  attributesFlatJson: z.string(),
  attributeKeys: z.array(z.string()),
  droppedAttributesCount: z.number().int().nonnegative(),
  flags: z.number().int().nonnegative(),
  eventName: z.string(),
  providerKind: logProviderKindSchema,
  providerEventKind: z.string(),
  providerEventSequence: z.string(),
  providerSessionId: z.string(),
  providerConversationId: z.string(),
  providerPromptId: z.string(),
  piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL", "DISABLED"]),
  canonicalPayload: z.string(),
  canonicalSizeBytes: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  acceptedAt: z.number().int().nonnegative(),
});

export type CanonicalLogRecord = z.infer<typeof canonicalLogRecordSchema>;

/** The portable trace-correlated read shape derived from canonical log storage. */
export const canonicalTraceLogRecordSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  timeUnixMs: z.number().int().nonnegative(),
  body: z.string(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
  scopeName: z.string(),
  scopeVersion: z.string().nullable(),
});
export type CanonicalTraceLogRecord = z.infer<typeof canonicalTraceLogRecordSchema>;
