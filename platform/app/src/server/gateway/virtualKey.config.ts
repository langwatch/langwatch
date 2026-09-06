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

export const guardrailDirectionSchema = z.enum(["pre", "post", "stream_chunk"]);
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

/**
 * VK tags ride every single gateway request: the data plane stamps them on
 * each customer span as `langwatch.labels`, the trace pipeline unions that
 * into the trace's `metadata.labels`, and the Trace Explorer's Label facet
 * aggregates every distinct value with `arrayJoin`. Tags are therefore a
 * cardinality surface, not free-form storage, and the tag list arrives from
 * an unvalidated REST body just as easily as from the drawer.
 *
 * The bounds are applied as a parse-time normalisation rather than a
 * rejection so that reading a virtual key never throws: `parseVirtualKeyConfig`
 * runs on the config-fetch path the gateway depends on, and a row that
 * predates the bound must still resolve to a servable bundle.
 */
export const VK_TAGS_MAX_COUNT = 32;
export const VK_TAG_MAX_LENGTH = 128;

export function normalizeVkTags(tags: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    // Slice by code point so truncation can never split a surrogate pair
    // into lone halves, which serialise as invalid UTF-8 downstream.
    const tag = [...raw.trim()].slice(0, VK_TAG_MAX_LENGTH).join("").trim();
    if (tag === "") continue;
    normalized.add(tag);
    if (normalized.size === VK_TAGS_MAX_COUNT) break;
  }
  return [...normalized];
}

export const virtualKeyConfigSchema = z.object({
  modelsAllowed: z.array(z.string()).nullable().default(null),
  /**
   * ModelProvider ids the key may dispatch to. `null` is not "none": it is
   * "every provider this key can reach through its scope graph, including
   * providers added later". That is the semantic a creator gets by leaving
   * the All box ticked, and storing it as absence is what makes a provider
   * added next month usable without touching the key.
   *
   * An explicit list must name at least one provider. That rule is
   * enforced on the write path (`VirtualKeyService`), not here: this
   * schema also parses on the gateway's config-fetch, where throwing on a
   * malformed stored row would take the key offline instead of degrading.
   * Reading an empty list therefore normalises to the permissive default
   * rather than to a key that can serve nothing.
   */
  providersAllowed: z
    .array(z.string())
    .nullable()
    .default(null)
    .transform((v) => (v && v.length > 0 ? v : null)),
  cache: z
    .object({
      mode: cacheModeSchema.default("respect"),
      ttlS: z.number().int().nonnegative().default(3600),
    })
    .default({ mode: "respect", ttlS: 3600 }),
  /**
   * How many providers one request may be tried against. Which failures are
   * worth another provider is not configurable: the gateway decides that from
   * the real upstream outcome, in one place. A per-key trigger list could only
   * narrow the set, and every narrowing turns a failure the gateway could have
   * recovered from into one the customer sees.
   *
   * Stored configs written before this shape may still carry `on` and
   * `timeoutMs`; the schema drops them on read.
   */
  fallback: z
    .object({
      maxAttempts: z.number().int().positive().default(3),
    })
    .default({ maxAttempts: 3 }),
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
  /**
   * How many brokered realtime voice sessions this key may hold open at
   * once. `null` is unlimited.
   *
   * Voice needs its own cap because the arrival-rate limits above do not
   * bound it. `rpm` counts requests as they arrive, and a session mint is
   * one request that opens a call billing by the minute for as long as it
   * runs, so a key at 60 rpm can hold sixty ten-minute calls per replica
   * without tripping anything.
   *
   * Deliberately NOT carried on the gateway config bundle. The cap is read
   * inside the control plane's reserve transaction, next to the count it
   * gates, so a limit edited a minute ago applies to the next mint. Shipping
   * it on the bundle would put the limit on the config cache's clock and the
   * count on the database's, and this chain already carries one field that
   * is materialized, sent and then dropped at decode with nothing reading it.
   */
  realtime: z
    .object({
      maxOpenSessions: z.number().int().positive().nullable().default(null),
    })
    .default({ maxOpenSessions: null }),
  metadata: z
    .object({
      label: z.string().optional(),
      tags: z.array(z.string()).default([]).transform(normalizeVkTags),
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
