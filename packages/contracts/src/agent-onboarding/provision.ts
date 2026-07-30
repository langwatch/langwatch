import { z } from "zod";
import {
  accountRefSchema,
  agentSlugSchema,
  fingerprintSchema,
  lifecycleNoticeSchema,
  lifecycleSchema,
} from "./primitives.js";

/**
 * `POST /provision` — the anonymous front door. No email, no name, no
 * password: an agent cannot fill in a form, so the only thing asked for is
 * which tool is calling.
 */
export const provisionRequestSchema = z.object({
  agent: agentSlugSchema,
  /** Optional; absent is allowed and is not treated as a shared value. */
  fingerprint: fingerprintSchema.optional(),
  /** Reported for support, never used for auth or routing. */
  clientVersion: z.string().max(64).optional(),
  /** Defaults to a name derived from the agent when omitted. */
  projectName: z.string().min(1).max(64).optional(),
});
export type ProvisionRequest = z.infer<typeof provisionRequestSchema>;

/**
 * The write-only credential the agent exports with. Ingestion-only by
 * construction: the key is handed to an agent and will land in its transcript,
 * so it must be worthless for reading data — including its own.
 */
export const ingestionGrantSchema = z.object({
  /** Returned exactly once, at provisioning. */
  apiKey: z.string(),
  keyPrefix: z.string(),
  /** Base URL of the control plane that minted the key. */
  endpoint: z.string().url(),
  /** Where OTLP traffic goes — what the agent's `OTEL_*` config points at. */
  otlpEndpoint: z.string().url(),
});
export type IngestionGrant = z.infer<typeof ingestionGrantSchema>;

/**
 * The capability that turns the temporary account into a real one. The
 * plaintext token exists only in this response; the server keeps a hash, so a
 * client that loses it cannot be helped and no endpoint can reproduce it.
 */
export const claimGrantSchema = z.object({
  token: z.string(),
  /** Human-facing page that explains the CLI → browser handoff. */
  url: z.string().url(),
  claimableUntil: z.string().datetime(),
});
export type ClaimGrant = z.infer<typeof claimGrantSchema>;

export const provisionResponseSchema = z.object({
  account: accountRefSchema,
  ingestion: ingestionGrantSchema,
  claim: claimGrantSchema,
  lifecycle: lifecycleSchema,
  notice: lifecycleNoticeSchema,
});
export type ProvisionResponse = z.infer<typeof provisionResponseSchema>;

/** `GET /status` — the countdown the CLI prints. Claim token as bearer. */
export const statusResponseSchema = z.object({
  account: accountRefSchema,
  lifecycle: lifecycleSchema,
  notice: lifecycleNoticeSchema,
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;
