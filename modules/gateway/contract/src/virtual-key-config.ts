import type { Named } from "@langwatch/module";
/**
 * Virtual-key config schema stored in VirtualKey.config; mirrors specs and Go
 * gateway struct. Unknown keys lenient.
 */
import { z } from "zod";

export const cacheModeSchema = z.enum(["respect", "force", "disable"]);
export type CacheMode = z.infer<typeof cacheModeSchema>;

export const guardrailDirectionSchema = z.enum(["pre", "post", "stream_chunk"]);
export type GuardrailDirection = z.infer<typeof guardrailDirectionSchema>;

// VK opt-in / opt-out wiring to project guardrails. Each entry binds a
// direction to N GatewayGuardrail row ids. The GatewayGuardrail row
// itself owns evaluator + failure mode; the VK only declares the
// reference. See specs/ai-gateway/governance/guardrails-project-scope.feature.
const guardrailAttachmentSchemaDefinition = z.object({
  direction: guardrailDirectionSchema,
  guardrailIds: z.array(z.string()).default([]),
});
export interface GuardrailAttachmentSchema extends Named<
  typeof guardrailAttachmentSchemaDefinition
> {}
export const guardrailAttachmentSchema: GuardrailAttachmentSchema =
  guardrailAttachmentSchemaDefinition;
export type GuardrailAttachment = z.infer<typeof guardrailAttachmentSchema>;

/**
 * VK tags ride every gateway request as `langwatch.labels`; cardinality
 * surface normalized at parse-time to never throw on read.
 */
export const VK_TAGS_MAX_COUNT = 32;
export const VK_TAG_MAX_LENGTH = 128;

export function normalizeVkTags(tags: readonly unknown[]): string[] {
  const normalized = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    // Slice by code point so truncation can never split a surrogate pair
    // into lone halves, which serialise as invalid UTF-8 downstream.
    const tag = Array.from(raw.trim()).slice(0, VK_TAG_MAX_LENGTH).join("").trim();
    if (tag === "") continue;
    normalized.add(tag);
    if (normalized.size === VK_TAGS_MAX_COUNT) break;
  }
  return [...normalized];
}

const cacheConfigSchema = z.object({
  mode: cacheModeSchema.default("respect"),
  ttlS: z.number().int().nonnegative().default(3600),
});
/** Max providers tried per request; failures gateway decides non-configurable. */
const fallbackConfigSchema = z.object({
  maxAttempts: z.number().int().positive().default(3),
});
const rateLimitsConfigSchema = z.object({
  rpm: z.number().int().nullable().default(null),
  tpm: z.number().int().nullable().default(null),
  rpd: z.number().int().nullable().default(null),
});
/** Max open realtime voice sessions; null is unlimited. Read in control plane reserve. */
const realtimeConfigSchema = z.object({
  maxOpenSessions: z.number().int().positive().nullable().default(null),
});
const metadataConfigSchema = z.object({
  label: z.string().optional(),
  tags: z.array(z.string()).default([]).transform(normalizeVkTags),
});
/** ModelProvider ids; null means all providers including future ones. */
const providersAllowedSchema = z.array(z.string()).nullable();
const emptyProvidersMeanAll = (v: string[] | null) => (v && v.length > 0 ? v : null);

const virtualKeyConfigSchemaDefinition = z.object({
  modelsAllowed: z.array(z.string()).nullable().default(null),
  providersAllowed: providersAllowedSchema.default(null).transform(emptyProvidersMeanAll),
  cache: cacheConfigSchema.default({ mode: "respect", ttlS: 3600 }),
  fallback: fallbackConfigSchema.default({ maxAttempts: 3 }),
  // Attachments to project-scoped GatewayGuardrail rows.
  // Empty array = VK opts out of every project guardrail.
  guardrailAttachments: z.array(guardrailAttachmentSchema).default([]),
  rateLimits: rateLimitsConfigSchema.default({ rpm: null, tpm: null, rpd: null }),
  realtime: realtimeConfigSchema.default({ maxOpenSessions: null }),
  metadata: metadataConfigSchema.default({ tags: [] }),
});
export interface VirtualKeyConfigSchema extends Named<typeof virtualKeyConfigSchemaDefinition> {}
export const virtualKeyConfigSchema: VirtualKeyConfigSchema = virtualKeyConfigSchemaDefinition;

export type VirtualKeyConfig = z.infer<typeof virtualKeyConfigSchema>;

/**
 * A config change: only the sections named are replaced, so no section has a default
 * here. `virtualKeyConfigSchema.partial()` would still fill every omitted one.
 */
const virtualKeyConfigPatchSchemaDefinition = z.object({
  modelsAllowed: z.array(z.string()).nullable().optional(),
  providersAllowed: providersAllowedSchema.transform(emptyProvidersMeanAll).optional(),
  cache: cacheConfigSchema.optional(),
  fallback: fallbackConfigSchema.optional(),
  guardrailAttachments: z.array(guardrailAttachmentSchema).optional(),
  rateLimits: rateLimitsConfigSchema.optional(),
  realtime: realtimeConfigSchema.optional(),
  metadata: metadataConfigSchema.optional(),
});
export interface VirtualKeyConfigPatchSchema extends Named<
  typeof virtualKeyConfigPatchSchemaDefinition
> {}
export const virtualKeyConfigPatchSchema: VirtualKeyConfigPatchSchema =
  virtualKeyConfigPatchSchemaDefinition;
export type VirtualKeyConfigPatch = z.infer<typeof virtualKeyConfigPatchSchema>;

export function parseVirtualKeyConfig(raw: unknown): VirtualKeyConfig {
  return virtualKeyConfigSchema.parse(raw ?? {});
}

export function defaultVirtualKeyConfig(): VirtualKeyConfig {
  return virtualKeyConfigSchema.parse({});
}
