/**
 * The wire the Go data plane dials `/api/internal/gateway` with.
 *
 * These are request shapes, so they live in the contract rather than beside the
 * transport: the same bytes are written by the gateway's own Go client, and a
 * schema only the server could see would be a promise nothing else can read.
 *
 * Every field is spelled the way the data plane spells it — lower_snake_case,
 * `project_id` for the tenant — because these are the exact bodies a deployed
 * gateway sends. Nothing here may be renamed without changing the Go half in
 * the same release.
 */
import { z } from "zod";

import { GUARDRAIL_WIRE_DIRECTIONS } from "./gateway-guardrail.ts";
import { spendUsageSchema } from "./gateway-spend.schemas.ts";

/** The virtual key a data-plane node presents for exchange against a JWT. */
export const gatewayInternalResolveKeySchema = z.object({
  key_presented: z.string().min(1),
  /** Which node asked. Recorded on the auth decision log, never enforced. */
  gateway_node_id: z.string().optional(),
});

/** The provider row whose Codex session a 401 recovery re-mints against. */
export const gatewayInternalCodexRefreshSchema = z.object({
  provider_row_id: z.string().min(1),
});

/** The key whose warm-cache configuration bundle is being revalidated. */
export const gatewayInternalConfigParamsSchema = z.object({
  vk_id: z.string().min(1),
});

/**
 * One guardrail verdict request.
 *
 * The direction vocabulary is the WIRE's, deliberately not the stored Prisma
 * enum: a storage-value mismatch here fails every real call, and a guardrail
 * that cannot answer falls open.
 */
export const gatewayInternalGuardrailCheckSchema = z.object({
  vk_id: z.string().min(1),
  project_id: z.string().min(1),
  gateway_request_id: z.string().optional(),
  direction: z.enum(GUARDRAIL_WIRE_DIRECTIONS),
  guardrail_ids: z.array(z.string()).default([]),
  content: z
    .object({
      messages: z.unknown().optional(),
      output: z.unknown().optional(),
      chunk: z.unknown().optional(),
      tools: z.unknown().optional(),
      mcps: z.unknown().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** The three commands the spend spine accepts, as the drainer names them. */
export const GATEWAY_INTERNAL_SPEND_COMMANDS = [
  "admitSpend",
  "confirmSpend",
  "failSpend",
] as const;

export type GatewayInternalSpendCommandName = (typeof GATEWAY_INTERNAL_SPEND_COMMANDS)[number];

/**
 * One drained spend record. The payload is left unread here and validated
 * against the command's own schema after `project_id` is mapped to the
 * internal tenant id, so a record rejected for its payload is told apart from
 * a record whose envelope was malformed.
 */
export const gatewayInternalSpendCommandSchema = z.object({
  command: z.enum(GATEWAY_INTERNAL_SPEND_COMMANDS),
  payload: z.record(z.string(), z.unknown()),
  /** Which pod drained it, and where in that pod's sequence — the gap detector's evidence. */
  pod_id: z.string().max(128).default(""),
  pod_seq: z.number().int().min(0).default(0),
});

export type GatewayInternalSpendCommandRecord = z.infer<typeof gatewayInternalSpendCommandSchema>;

/** A drain batch. Capped so one post cannot outgrow a single append transaction. */
export const gatewayInternalSpendCommandBatchSchema = z.object({
  records: z.array(gatewayInternalSpendCommandSchema).min(1).max(500),
});

/** The realtime voice session a mint is booked against. */
export const gatewayInternalReserveSessionSchema = z.object({
  session_id: z.string().min(1).max(256),
  project_id: z.string().min(1).max(256),
  organization_id: z.string().min(1).max(256),
  virtual_key_id: z.string().min(1).max(256),
  model_provider_id: z.string().min(1).max(256),
  /**
   * The trace the mint's own span belongs to. Optional so a gateway that
   * predates this field, or a request with no trace context, still books.
   */
  trace_id: z.string().max(128).optional(),
  requested_model: z.string().max(512).optional(),
  vendor: z.enum(["openai", "elevenlabs"]),
  agent_id: z.string().max(256).optional(),
  model: z.string().min(1).max(512),
});

/**
 * A correlation or a terminal status on a booked session.
 *
 * Both fields are optional on their own; the refinement stops a project_id-only
 * body from parsing, applying nothing, and answering 404 as though the session
 * were missing.
 */
export const gatewayInternalPatchSessionSchema = z
  .object({
    project_id: z.string().min(1).max(256),
    vendor_conversation_id: z.string().min(1).max(256).optional(),
    status: z.enum(["FAILED", "EXPIRED"]).optional(),
    reason: z.string().max(256).optional(),
  })
  .refine((body) => Boolean(body.vendor_conversation_id ?? body.status), {
    message: "a vendor_conversation_id or a terminal status is required",
  });

/**
 * What one booked session consumed.
 *
 * `virtual_key_id` is required, not optional: several virtual keys can point at
 * one project, so the project alone does not say whose session this is, and the
 * spend record belongs to the key that was admitted.
 */
export const gatewayInternalReportUsageSchema = z.object({
  project_id: z.string().min(1).max(256),
  virtual_key_id: z.string().min(1).max(256),
  usage: spendUsageSchema,
});

/** The booked session a patch or a usage report names. */
export const gatewayInternalSessionParamsSchema = z.object({
  session_id: z.string().min(1),
});
