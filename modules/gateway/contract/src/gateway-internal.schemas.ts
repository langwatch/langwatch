/**
 * Wire shapes the Go data plane sends to /api/internal/gateway; uses Go
 * naming (lower_snake_case), matches deployed gateway exactly.
 */
import { z } from "zod";

import { GUARDRAIL_WIRE_DIRECTIONS } from "./gateway-guardrail.ts";
import { spendUsageSchema } from "./gateway-spend.schemas.ts";

/** The virtual key a data-plane node presents for exchange against a JWT. */
export const gatewayInternalResolveKeySchema = z.object({
  key_presented: z.string().min(1),
  /** The install presenting an `lwl_` license token; ignored for a virtual key. */
  instance_id: z.string().optional(),
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
 * One guardrail verdict request. The direction vocabulary is the WIRE's,
 * deliberately not the stored Prisma enum: a mismatch here fails every real
 * call, and a guardrail that cannot answer falls open.
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
export const GATEWAY_INTERNAL_SPEND_COMMANDS = ["admitSpend", "confirmSpend", "failSpend"] as const;

export type GatewayInternalSpendCommandName = (typeof GATEWAY_INTERNAL_SPEND_COMMANDS)[number];

/**
 * One drained spend record. The payload is left unread here, validated
 * against the command's own schema after `project_id` maps to the tenant
 * id — a payload rejection is told apart from a malformed envelope.
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
 * A correlation or a terminal status on a booked session. Both fields are
 * optional alone; the refinement stops a project_id-only body from parsing
 * and 404ing as though the session were missing.
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
 * What one booked session consumed. `virtual_key_id` is required: several
 * keys can point at one project, so the project alone doesn't say whose
 * session this is — spend belongs to the key that was admitted.
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

const gatewayInternalRefusalSchema = z.object({
  error: z
    .object({ type: z.string(), code: z.string(), message: z.string() })
    .catchall(z.unknown()),
});
const internalRefusals = {
  400: gatewayInternalRefusalSchema,
  401: gatewayInternalRefusalSchema,
  403: gatewayInternalRefusalSchema,
  404: gatewayInternalRefusalSchema,
  429: gatewayInternalRefusalSchema,
  501: gatewayInternalRefusalSchema,
  503: gatewayInternalRefusalSchema,
} as const;
export const gatewayInternalHealthAnswers = {
  ...internalRefusals,
  200: z.object({ status: z.literal("ok") }),
} as const;
export const gatewayInternalResolveKeyAnswers = {
  ...internalRefusals,
  200: z.object({
    jwt: z.string(),
    revision: z.string(),
    key_id: z.string(),
    display_prefix: z.string(),
  }),
} as const;
export const gatewayInternalCodexRefreshAnswers = {
  ...internalRefusals,
  200: z.object({ access_token: z.string(), account_id: z.string().nullable() }),
} as const;
// The bundle includes provider-specific config that the Go data plane interprets.
export const gatewayInternalConfigAnswers = {
  ...internalRefusals,
  200: z.object({}).catchall(z.unknown()),
  304: z.void(),
} as const;
export const gatewayInternalChangesAnswers = {
  ...internalRefusals,
  200: z.object({
    current_revision: z.string(),
    changes: z.array(
      z.object({
        kind: z.string(),
        virtual_key_id: z.string().nullable(),
        budget_id: z.string().nullable(),
        model_provider_id: z.string().nullable(),
        project_id: z.string().nullable(),
        revision: z.string(),
      }),
    ),
  }),
  204: z.void(),
} as const;
export const gatewayInternalGuardrailAnswers = {
  ...internalRefusals,
  200: z.object({
    decision: z.enum(["allow", "block", "modify"]),
    reason: z.string().nullable(),
    modified_content: z.record(z.string(), z.unknown()).nullable(),
    policies_triggered: z.array(z.string()),
  }),
} as const;
export const gatewayInternalBucketSpendAnswers = {
  ...internalRefusals,
  200: z.object({ spent_micro_usd: z.number(), bucket: z.string().nullable() }),
} as const;
export const gatewayInternalSpendCommandsAnswers = {
  ...internalRefusals,
  200: z.object({
    accepted: z.number(),
    rejected: z.array(z.object({ index: z.number(), code: z.string() })),
  }),
} as const;
export const gatewayInternalReserveSessionAnswers = {
  ...internalRefusals,
  200: z.object({ session_id: z.string(), status: z.literal("OPEN") }),
} as const;
export const gatewayInternalPatchSessionAnswers = {
  ...internalRefusals,
  200: z.object({ session_id: z.string(), updated: z.literal(true) }),
} as const;
export const gatewayInternalReportUsageAnswers = {
  ...internalRefusals,
  200: z.object({ session_id: z.string(), status: z.literal("CLOSED") }),
} as const;
export const gatewayInternalBootstrapAnswers = {
  ...internalRefusals,
  200: z.object({
    keys: z.array(
      z.object({
        jwt: z.string(),
        revision: z.string(),
        key_id: z.string(),
        display_prefix: z.string(),
        config: z.object({}).catchall(z.unknown()),
      }),
    ),
    next_page_token: z.string().nullable(),
    current_revision: z.string(),
  }),
} as const;

export const gatewayInternalHeadersSchema = z.object({
  "if-none-match": z.string().optional(),
  "x-langwatch-gateway-node": z.string().optional(),
});
export const gatewayInternalChangesQuerySchema = z.object({
  organization_id: z.string().optional(),
  since: z.string().default("0"),
  timeout_s: z.string().default("10"),
});
export const gatewayInternalBucketQuerySchema = z.object({
  budget_id: z.string().default(""),
  end_user_id: z.string().default(""),
});
