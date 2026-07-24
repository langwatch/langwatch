/**
 * Virtual-key config schema — the JSON blob stored in `VirtualKey.config`
 * and returned by `GET /api/internal/gateway/config/:vk_id`.
 *
 * Mirrors specs/ai-gateway/_shared/contract.md §4.2. Keep this schema in
 * sync with the Go gateway's equivalent struct. When fields are added here
 * without a matching gateway release, the gateway must ignore unknown keys
 * (it does — `json.Decoder` is lenient).
 */
import { z } from "zod";

export const cacheModeSchema = z.enum(["respect", "force", "disable"]);
export type CacheMode = z.infer<typeof cacheModeSchema>;

export const fallbackTriggerSchema = z.enum([
  "5xx",
  "timeout",
  "rate_limit_exceeded",
  "network_error",
  "circuit_breaker",
]);
export type FallbackTrigger = z.infer<typeof fallbackTriggerSchema>;

export const guardrailDirectionSchema = z.enum([
  "pre",
  "post",
  "stream_chunk",
]);
export type GuardrailDirection = z.infer<typeof guardrailDirectionSchema>;

// VK opt-in / opt-out wiring to project guardrails. Each entry binds a
// direction to N GatewayGuardrail row ids. The GatewayGuardrail row
// itself owns evaluator + failure mode; the VK only declares the
// reference. See specs/ai-gateway/governance/guardrails-project-scope.feature.
export const guardrailAttachmentSchema = z.object({
  direction: guardrailDirectionSchema,
  guardrailIds: z.array(z.string()).default([]),
});
export type GuardrailAttachment = z.infer<typeof guardrailAttachmentSchema>;

export const virtualKeyConfigSchema = z.object({
  modelsAllowed: z.array(z.string()).nullable().default(null),
  cache: z
    .object({
      mode: cacheModeSchema.default("respect"),
      ttlS: z.number().int().nonnegative().default(3600),
    })
    .default({ mode: "respect", ttlS: 3600 }),
  fallback: z
    .object({
      on: z.array(fallbackTriggerSchema).default(["5xx", "timeout", "rate_limit_exceeded"]),
      timeoutMs: z.number().int().positive().default(30000),
      maxAttempts: z.number().int().positive().default(3),
    })
    .default({
      on: ["5xx", "timeout", "rate_limit_exceeded"],
      timeoutMs: 30000,
      maxAttempts: 3,
    }),
  // Attachments to project-scoped GatewayGuardrail rows.
  // Empty array = VK opts out of every project guardrail.
  guardrailAttachments: z.array(guardrailAttachmentSchema).default([]),
  rateLimits: z
    .object({
      rpm: z.number().int().nullable().default(null),
      tpm: z.number().int().nullable().default(null),
      rpd: z.number().int().nullable().default(null),
    })
    .default({ rpm: null, tpm: null, rpd: null }),
  metadata: z
    .object({
      label: z.string().optional(),
      tags: z.array(z.string()).default([]),
    })
    .default({ tags: [] }),
});

export type VirtualKeyConfig = z.infer<typeof virtualKeyConfigSchema>;

export function parseVirtualKeyConfig(raw: unknown): VirtualKeyConfig {
  return virtualKeyConfigSchema.parse(raw ?? {});
}

export function defaultVirtualKeyConfig(): VirtualKeyConfig {
  return virtualKeyConfigSchema.parse({});
}
