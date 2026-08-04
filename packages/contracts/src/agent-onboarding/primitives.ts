import { z } from "zod";

/**
 * Coding agents that can drive `npx langwatch <agent>`. The slug doubles as
 * the ingestion key's `sourceType`, so it is stamped onto every span the
 * agent exports as `langwatch.source` provenance — which is why it is a
 * closed set rather than a free string.
 */
export const agentSlugSchema = z.enum([
  "claude_code",
  "claude_cowork",
  "codex",
  "gemini",
  "opencode",
]);
export type AgentSlug = z.infer<typeof agentSlugSchema>;

/**
 * Where an ephemeral account sits on the unclaimed ramp. Always derived from
 * the two deadlines plus `claimedAt` — never persisted as a column, so a late
 * background job can't make a countdown wrong.
 *
 * - `active`    — ingesting and readable.
 * - `read_only` — past the ingestion deadline, data preserved and claimable.
 * - `expired`   — past the deletion deadline; the data is gone.
 * - `claimed`   — an identity is attached; the deadlines no longer apply.
 */
export const accountStateSchema = z.enum([
  "active",
  "read_only",
  "expired",
  "claimed",
]);
export type AccountState = z.infer<typeof accountStateSchema>;

/** Identity of the workspace a provisioning call created. */
export const accountRefSchema = z.object({
  organizationId: z.string(),
  projectId: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
});
export type AccountRef = z.infer<typeof accountRefSchema>;

/**
 * The lifecycle as the CLI needs to render it. Deadlines are absolute
 * timestamps because the CLI writes them to its global config and reads them
 * back days later — a relative "7 days" would be a lie on the second read.
 * Both are null once claimed.
 */
export const lifecycleSchema = z.object({
  state: accountStateSchema,
  provisionedAt: z.string().datetime(),
  ingestionStopsAt: z.string().datetime().nullable(),
  deleteAfter: z.string().datetime().nullable(),
  /** Whole days left in the current phase; null when claimed or expired. */
  daysRemainingInPhase: z.number().int().nonnegative().nullable(),
});
export type Lifecycle = z.infer<typeof lifecycleSchema>;

/**
 * Server-rendered copy for the deadlines. It lives on the wire rather than in
 * the CLI because the windows are deployment configuration: a self-hosted
 * install with different windows would otherwise print numbers that don't
 * match what its own server enforces.
 */
export const lifecycleNoticeSchema = z.object({
  dataRetention: z.string(),
  claimWindow: z.string(),
  afterExpiry: z.string(),
});
export type LifecycleNotice = z.infer<typeof lifecycleNoticeSchema>;

/**
 * The axis that refused a request, echoed in the `rate_limited` error's meta.
 * Naming it lets an operator tell "one abusive host" from "the whole endpoint
 * is saturated" without reading the limiter's logs.
 */
export const rateLimitAxisSchema = z.enum([
  "fingerprint",
  "ip",
  "ip_subnet",
  "global",
  "claim_ip",
  "claim_failure",
  "poll",
]);
export type RateLimitAxis = z.infer<typeof rateLimitAxisSchema>;

/**
 * An opaque, stable-per-machine identifier the client may send so a single
 * host cannot farm accounts by moving between networks. Bounded on both ends:
 * too short to be a real fingerprint, or long enough to be a payload, is a
 * rejection rather than something to hash and store.
 */
export const fingerprintSchema = z.string().min(16).max(512);
