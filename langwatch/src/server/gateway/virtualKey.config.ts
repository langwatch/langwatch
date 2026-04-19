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

export const guardrailRefSchema = z.object({
  id: z.string(),
  evaluator: z.string(),
});

export const blockedPatternsSchema = z.object({
  deny: z.array(z.string()).default([]),
  allow: z.array(z.string()).nullable().default(null),
});

export const virtualKeyConfigSchema = z.object({
  modelAliases: z.record(z.string(), z.string()).default({}),
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
  guardrails: z
    .object({
      pre: z.array(guardrailRefSchema).default([]),
      post: z.array(guardrailRefSchema).default([]),
      streamChunk: z.array(guardrailRefSchema).default([]),
      // Fail-open flips from 503 guardrail_upstream_unavailable (default,
      // fail-closed) to allow-with-warn-log when the evaluator backend is
      // unreachable. Symmetric per direction — @sergey iter 11 landed the
      // response side; request side mirrors the same semantic.
      requestFailOpen: z.boolean().default(false),
      responseFailOpen: z.boolean().default(false),
    })
    .default({
      pre: [],
      post: [],
      streamChunk: [],
      requestFailOpen: false,
      responseFailOpen: false,
    }),
  blockedPatterns: z
    .object({
      tools: blockedPatternsSchema.default({ deny: [], allow: null }),
      mcp: blockedPatternsSchema.default({ deny: [], allow: null }),
      urls: blockedPatternsSchema.default({ deny: [], allow: null }),
      // §5 models dimension — RE2 regex policy distinct from
      // `modelsAllowed` glob allowlist. Enforced by @sergey iter 8
      // (internal/blocked) before provider dispatch.
      models: blockedPatternsSchema.default({ deny: [], allow: null }),
    })
    .default({
      tools: { deny: [], allow: null },
      mcp: { deny: [], allow: null },
      urls: { deny: [], allow: null },
      models: { deny: [], allow: null },
    }),
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
