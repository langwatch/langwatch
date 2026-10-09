import { z } from "zod";

const logCorrelationSourceSchema = z.enum([
  "none",
  "wire",
  "claude_synthesized",
  "codex_synthesized",
]);

const logProviderKindSchema = z.enum(["generic", "claude_code", "codex"]);

/** The trace-fold payload derived from one canonical log record. */
export const logTraceContributionSchema = z.object({
  tenantId: z.string(),
  recordId: z.string().regex(/^[a-f0-9]{64}$/),
  traceId: z.string().regex(/^[a-f0-9]{32}$/),
  spanId: z.string().regex(/^[a-f0-9]{16}$/),
  timeUnixMs: z.number().int().nonnegative(),
  severityNumber: z.number().int().min(0).max(255),
  severityText: z.string(),
  providerKind: logProviderKindSchema,
  scopeName: z.string(),
  correlationSource: logCorrelationSourceSchema.exclude(["none"]),
  input: z.string().nullable(),
  output: z.string().nullable(),
  liftedAttributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  nonBillable: z.boolean(),
  piiRedactionLevel: z.enum(["STRICT", "ESSENTIAL", "DISABLED"]),
  occurredAt: z.number().int().nonnegative(),
});

export type LogTraceContribution = z.infer<typeof logTraceContributionSchema>;
