/**
 * Public REST API for managing AI Gateway resources from SDKs, CLIs, and
 * CI pipelines. Parallels the `virtualKeys` / `gatewayBudgets` /
 * `gatewayUsage` tRPC routers consumed by the UI.
 *
 * Auth: standard project API key (`Authorization: Bearer <projectApiKey>`
 * or `X-Auth-Token`), or a scoped API key. There is exactly one
 * implementation of every write rule: handlers route through the SAME
 * service-layer methods and pre-flight asserts the tRPC mutations use
 * (`VirtualKeyService`, `GatewayBudgetService`, `virtualKey.authz`), so
 * the two doors cannot drift apart. Handlers translate wire casing and
 * map TRPCError onto HTTP; they add no business rules of their own.
 *
 * Writes are audited to `AuditLog` (gateway shape). For scoped API keys
 * the actor is the key's owning user; legacy project keys carry no user,
 * so the actor is a synthetic machine principal `svc_<projectId>` (see
 * `machineActorForProject`) — a stable per-project id for forensic
 * queries. `AuditLog.userId` is nullable post-consolidation, so a future
 * service-to-service write path can drop the synthetic id entirely.
 */

import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { GatewayCacheRule, Project } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import type { AuthMiddlewareVariables } from "~/app/api/middleware/auth";
import {
  IDEMPOTENCY_KEY_HEADER,
  readIdempotencyKey,
  withIdempotency,
} from "~/server/api/idempotency";
import { apiKeyPermission, createProjectApp } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { toBudgetDto } from "~/server/gateway/budget.dto";
import {
  type BudgetScope,
  GatewayBudgetService,
} from "~/server/gateway/budget.service";
import type { CacheRuleCursor } from "~/server/gateway/cacheRule.service";
import { GatewayCacheRuleService } from "~/server/gateway/cacheRule.service";
import {
  EXTERNAL_ID_MAX_LENGTH,
  externalIdSchema,
  resourceMetadataSchema,
} from "~/server/gateway/resourceMetadata";
import { GatewayUsageService } from "~/server/gateway/usage.service";
import {
  assertActorCanManageAllScopes,
  assertActorCanOperateOnAnyScope,
  assertGuardrailAttachmentsAllowed,
  assertScopesBelongToOrg,
  assertTraceProjectBelongsToOrg,
  isVisibleToMembership,
  type MembershipSet,
  requireExistingVk,
  requireVisibleVk,
  resolveVkProjectId,
  type VirtualKeyActor,
} from "~/server/gateway/virtualKey.authz";
import {
  parseVirtualKeyConfig,
  virtualKeyConfigSchema,
} from "~/server/gateway/virtualKey.config";
import { toVirtualKeySnakeDto } from "~/server/gateway/virtualKey.dto";
// GatewayProviderCredentialService removed in iter 110; /providers REST
// routes return 410 Gone until A3 lands the ModelProvider-backed
// replacement surface (current proposal: fold into /model-providers).
import {
  type CreateVirtualKeyInput,
  type VirtualKeyBudgetInput,
  VirtualKeyService,
  virtualKeyBudgetInputSchema,
} from "~/server/gateway/virtualKey.service";
import { startOfCurrentMonthUTC } from "~/server/gateway/virtualKeySpend.clickhouse.repository";
import { toStoredEnum, toWireEnum } from "~/server/gateway/wireEnums";
import { USD_DISPLAY_STRING_FORMAT } from "~/server/gateway/wireMoney";
import {
  decodePageCursor,
  nextPageCursor,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
} from "~/server/gateway/wirePagination";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import {
  canonicalBaseResponses,
  canonicalConflictResponses,
} from "../../shared/base-responses";
import { requestTraceIds } from "../../shared/canonical-error";
import {
  idempotencyKeyParameter,
  idempotentJson,
  idempotentReplayHeaders,
} from "../../shared/idempotent-response";
import { apiErrorBody, apiErrorSchema } from "../../shared/schemas";

const logger = createLogger("langwatch:api:gateway-platform");

patchZodOpenapi();

// ── Wire enums ──────────────────────────────────────────────────────────
// Every enum this surface publishes and accepts is lower_snake_case, input
// AND output, with no dual-casing tolerance: the stored SCREAMING_SNAKE is
// Prisma's convention, not a contract, and `toWireEnum` / `toStoredEnum`
// translate at this seam in both directions.

const vkScopeTypeSchema = z.enum(["organization", "team", "project"]);

const budgetScopeTypeSchema = z.enum([
  "organization",
  "team",
  "project",
  "virtual_key",
  "principal",
  "group",
  "attributed_user",
]);

const budgetWindowSchema = z.enum([
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "total",
  "manual",
]);

const onBreachSchema = z.enum(["block", "warn"]);

const routingModeWireSchema = z.enum(["none", "fallback_all", "policy"]);

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// These mirror the shapes returned by toVirtualKeySnakeDto / budget DTO /
// cache-rule DTO. Kept in-file to stay a single source of truth per app.

const virtualKeyDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  // `disabled` is the reversible stop POST /virtual-keys/:id/disable puts a
  // key into. It was always reachable and never documented.
  status: z.enum(["active", "disabled", "revoked"]),
  purpose: z.enum(["user", "langy"]),
  display_prefix: z.string(),
  principal_user_id: z.string().nullable(),
  // Where an org- or team-owned key's traces and costs land. Not a
  // scope: it grants no access to the key.
  trace_project_id: z.string().nullable(),
  trace_project_source: z
    .enum(["explicit", "project_scope", "governance_fallback"])
    .describe(
      "Which rule puts this key's traces and costs where they go: `explicit` is the `trace_project_id` on the key, `project_scope` is its single project scope, and `governance_fallback` means the key names no destination and its spend is attributed to the organization's hidden governance project. Only the first two name a project the key itself chose, so a `governance_fallback` key is counted by no project budget a reader would think to look at. New keys can no longer be written in that shape.",
    ),
  /** The caller's own id for this key, unique within the organization. */
  external_id: z.string().nullable(),
  /** Customer-owned bookkeeping, echoed back verbatim. Never interpreted. */
  metadata: z.record(z.string(), z.string()),
  scopes: z.array(
    z.object({ scope_type: vkScopeTypeSchema, scope_id: z.string() }),
  ),
  routing_policy_id: z.string().nullable(),
  routing_mode: routingModeWireSchema,
  config: z.unknown(),
  revision: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});

const budgetDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  scope_type: budgetScopeTypeSchema,
  scope_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  window: budgetWindowSchema,
  on_breach: onBreachSchema,
  limit_usd: z
    .string()
    .describe(
      `Display value. ${USD_DISPLAY_STRING_FORMAT} Use limit_nano_usd for arithmetic.`,
    ),
  limit_nano_usd: z
    .number()
    .int()
    .nullable()
    .describe(
      "Canonical integer amount, nano-USD. Null past the safe integer range, where limit_usd still reads.",
    ),
  spent_usd: z
    .string()
    .nullable()
    .describe(
      `Display value, null when spend_available is false. ${USD_DISPLAY_STRING_FORMAT} Use spent_nano_usd for arithmetic.`,
    ),
  spent_nano_usd: z
    .number()
    .int()
    .nullable()
    .describe(
      "Canonical integer spend, nano-USD. Null when spend is unavailable. Derived from the same integer as spent_usd, so the pair always agrees.",
    ),
  timezone: z.string().nullable(),
  provider_key: z.string().nullable(),
  /** The caller's own id for this budget, unique within the organization. */
  external_id: z.string().nullable(),
  /** Customer-owned bookkeeping, echoed back verbatim. Never interpreted. */
  metadata: z.record(z.string(), z.string()),
  current_period_started_at: z
    .string()
    .describe(
      "Start of the period `spent_usd` covers, computed at read time. For an anchored budget this is its own cycle's start, not the calendar period's.",
    ),
  resets_at: z
    .string()
    .describe(
      "When the current period gives way to the next. Far-future for total and manual windows, which do not roll on their own.",
    ),
  cycle_anchor_at: z
    .string()
    .nullable()
    .describe(
      "The instant this budget's cycle is phased to. Null means no anchor: a calendar-aligned cyclic window, or one of the two windows that do not cycle (total, manual).",
    ),
  last_reset_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  member_count: z.number().int().optional(),
  end_users_seen: z.number().int().optional(),
  end_users_over: z.number().int().optional(),
  scope_reach: z
    .enum(["reachable", "unreachable"])
    .optional()
    .describe(
      "Whether any active key in the organization can produce traffic this budget matches. `unreachable` means it will never accrue and never block as configured: scope a key to its target, or move the budget where the keys already run. This is the only field that tells a budget nothing can reach apart from one that simply has not been breached.",
    ),
});

const spendSummaryDtoSchema = z.object({
  virtual_key_id: z.string(),
  spent_usd: z
    .string()
    .describe(
      `Spend over the window, summed from the cost path. ${USD_DISPLAY_STRING_FORMAT}`,
    ),
  requests: z.number().int(),
  /** Epoch milliseconds, the unit every spend surface takes and returns. */
  window: z.object({
    from: z.number().int(),
    to: z.number().int(),
  }),
});

/**
 * The spend window, in epoch milliseconds.
 *
 * This route used to take ISO-8601 strings while every other spend endpoint
 * took epoch-ms integers, so one reconciliation script had to hold two time
 * formats for the same concept. The echoed `window` is in the same unit as the
 * input, so a caller can feed a response straight back as the next request.
 */
const vkSpendWindowSchema = z.object({
  from: z.coerce.number().int().positive().safe().optional(),
  to: z.coerce.number().int().positive().safe().optional(),
});

const cacheRuleMatchersSchema = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const cacheRuleActionSchema = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();

const cacheRuleDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  enabled: z.boolean(),
  matchers: z.record(z.string(), z.unknown()),
  action: z.object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().optional(),
    salt: z.string().optional(),
  }),
  mode_enum: z.enum(["respect", "force", "disable"]),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Best-effort organization lookup for the project behind the API key.
 * Cached off the project row we already fetched in `authMiddleware`.
 */
async function orgIdForProject(projectId: string): Promise<string> {
  const team = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });
  if (!team) throw new Error(`project ${projectId} missing team`);
  return team.team.organizationId;
}

/** The paging half of every list response, in the /spend-events shape. */
const nextCursorSchema = z
  .string()
  .nullable()
  .describe(
    "Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page does NOT mean there is more.",
  );

// ── Request wire schemas ────────────────────────────────────────────────

/**
 * The page controls every unbounded list takes, matching /spend-events.
 *
 * `cursor` is opaque and passed back verbatim. A present-but-garbled cursor is
 * a 400 rather than a silent restart from the first row, which would re-serve
 * everything the caller already has.
 */
const pageQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(PAGE_LIMIT_MAX)
    .optional()
    .default(PAGE_LIMIT_DEFAULT),
});

/**
 * The `?external_id=` filter both governed lists take.
 *
 * Exact match on the caller's own id, which makes the list the lookup for a
 * resource whose LangWatch id the caller never stored. It returns a page
 * rather than a single row so one shape serves both readings, and so a caller
 * that has not yet claimed the id back gets an empty page, not a 404.
 */
const externalIdFilterSchema = z
  .string()
  .max(EXTERNAL_ID_MAX_LENGTH)
  .optional()
  .describe("Exact match on the resource's `external_id`.");

const virtualKeyListQuerySchema = pageQuerySchema.extend({
  external_id: externalIdFilterSchema,
});

const budgetListQuerySchema = pageQuerySchema.extend({
  scope_type: z
    .string()
    .optional()
    .describe(
      "Comma-separated subset of the scope types, lowercase, e.g. `virtual_key,principal`.",
    ),
  external_id: externalIdFilterSchema,
});

const resetBudgetQuerySchema = z.object({
  end_user_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Resets ONE end-user bucket on an attributed-user template, leaving the template period untouched.",
    ),
});

/** The (createdAt, id) sort key a cursor names, or a 400-worthy null. */
function createdAtIdCursor(
  encoded: string | undefined,
): { createdAt: Date; id: string } | null | undefined {
  if (encoded === undefined) return undefined;
  const parts = decodePageCursor(encoded, 2);
  if (!parts) return null;
  const createdAt = new Date(Number(parts[0]));
  return Number.isNaN(createdAt.getTime())
    ? null
    : { createdAt, id: String(parts[1]) };
}

/** The (priority, createdAt, id) sort key a cache-rule cursor names. */
function cacheRuleCursor(
  encoded: string | undefined,
): CacheRuleCursor | null | undefined {
  if (encoded === undefined) return undefined;
  const parts = decodePageCursor(encoded, 3);
  if (!parts) return null;
  const priority = Number(parts[0]);
  const createdAt = new Date(Number(parts[1]));
  return Number.isNaN(priority) || Number.isNaN(createdAt.getTime())
    ? null
    : { priority, createdAt, id: String(parts[2]) };
}

const invalidCursor = (c: GatewayContext) =>
  errorResponse(c, {
    status: 400,
    code: "invalid_cursor",
    message: "`cursor` is not a cursor this endpoint issued.",
  });

const scopeWireSchema = z.object({
  scope_type: vkScopeTypeSchema,
  scope_id: z.string().min(1),
});

/**
 * A positive USD amount on the wire: a number, or a decimal string (the
 * form that survives JSON round-trips without float drift). The string
 * branch is validated here so a malformed value answers 400 instead of
 * exploding into a Prisma Decimal parse further down.
 */
const usdAmountSchema = z
  .number()
  .positive()
  .or(
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "must be a decimal number of dollars")
      .refine((v) => Number.parseFloat(v) > 0, {
        message: "must be greater than zero",
      }),
  );

const budgetWireSchema = z.object({
  limit_usd: usdAmountSchema,
  window: z.enum(["day", "week", "month"]),
  on_breach: onBreachSchema.optional(),
  name: z.string().min(1).max(128).optional(),
});

const createVirtualKeySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  principal_user_id: z.string().nullable().optional(),
  /**
   * Visibility set. Defaults to the caller's own project when omitted, so
   * the plain reseller flow (mint a key for this project) needs no ids.
   */
  scopes: z.array(scopeWireSchema).min(1).optional(),
  /**
   * Explicit trace destination for org- and team-owned keys. NOT a
   * scope: it grants no visibility and no operate rights on the key.
   */
  trace_project_id: z.string().nullable().optional(),
  routing_policy_id: z.string().nullable().optional(),
  routing_mode: routingModeWireSchema.optional(),
  /** Optional cap created atomically with the key, targeted at the key. */
  budget: budgetWireSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
  /** The caller's own id for this key. 409s when the org already uses it. */
  external_id: externalIdSchema.nullable().optional(),
  /** Customer-owned bookkeeping. Never read by the gateway. */
  metadata: resourceMetadataSchema.optional(),
  /**
   * Only "user". Product-managed purposes (langy) are provisioned by the
   * product itself, never over the public API — a product-managed key is
   * hidden from reads and refuses mutations, which is nothing a customer
   * can ever want to mint.
   */
  purpose: z.literal("user").optional(),
});

const updateVirtualKeySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  scopes: z.array(scopeWireSchema).min(1).optional(),
  trace_project_id: z.string().nullable().optional(),
  routing_policy_id: z.string().nullable().optional(),
  routing_mode: routingModeWireSchema.optional(),
  /** Undefined leaves the key's cap alone; a value upserts it; null archives it. */
  budget: budgetWireSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
  /** Absent leaves it alone; null clears it; a value claims it. */
  external_id: externalIdSchema.nullable().optional(),
  /** REPLACES the stored map rather than merging into it. `{}` empties it. */
  metadata: resourceMetadataSchema.optional(),
});

const createCacheRuleSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: cacheRuleMatchersSchema,
  action: cacheRuleActionSchema,
});

const updateCacheRuleSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: cacheRuleMatchersSchema.optional(),
  action: cacheRuleActionSchema.optional(),
});

const updateBudgetSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  limit_usd: usdAmountSchema.optional(),
  on_breach: onBreachSchema.optional(),
  timezone: z.string().nullable().optional(),
  /** Absent leaves it alone; null clears it; a value claims it. */
  external_id: externalIdSchema.nullable().optional(),
  /** REPLACES the stored map rather than merging into it. `{}` empties it. */
  metadata: resourceMetadataSchema.optional(),
});

const disableVkSchema = z.object({
  /** Operator note, audit-logged and shown in the key's detail view. */
  reason: z.string().max(500).optional(),
});

const resetBudgetSchema = z.object({
  /** Free-text operator note, audit-logged with the reset. */
  reason: z.string().max(500).optional(),
});

const createBudgetSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("organization"), organization_id: z.string() }),
    z.object({ kind: z.literal("team"), team_id: z.string() }),
    z.object({ kind: z.literal("project"), project_id: z.string() }),
    z.object({ kind: z.literal("virtual_key"), virtual_key_id: z.string() }),
    z.object({ kind: z.literal("principal"), principal_user_id: z.string() }),
    // Per-member group budgets. Creation is service-guarded: it needs the
    // ClickHouse spend path (group_budget_requires_clickhouse otherwise).
    z.object({ kind: z.literal("group"), group_id: z.string() }),
    // Per-end-user template on an anchor (exactly one of the two ids).
    // Service-guarded like GROUP: per-user buckets need the spend ledger.
    z.object({
      kind: z.literal("attributed_user"),
      anchor_virtual_key_id: z.string().optional(),
      anchor_project_id: z.string().optional(),
    }),
  ]),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  window: budgetWindowSchema,
  limit_usd: usdAmountSchema,
  on_breach: onBreachSchema.optional(),
  timezone: z.string().nullable().optional(),
  /**
   * ModelProvider row id the budget counts and constrains. Null / absent
   * counts every provider. Orthogonal to the scope target, which is what
   * makes the full target x provider matrix expressible.
   */
  provider_key: z.string().nullable().optional(),
  /** The caller's own id for this budget. 409s when the org already uses it. */
  external_id: externalIdSchema.nullable().optional(),
  /** Customer-owned bookkeeping. Never read by the gateway. */
  metadata: resourceMetadataSchema.optional(),
  cycle_anchor_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "Phases the budget's cycle off this instant instead of the calendar, so a `month` budget anchored 2026-01-17T09:00:00Z starts a fresh period every 17th at 09:00 UTC. Omit for calendar alignment, which is the default and unchanged behaviour. A month cycle anchored past the 28th clamps into shorter months and springs back: anchored on the 31st gives Feb 28, then Mar 31. Immutable after create, since moving it would redraw periods the budget has already reported and enforced on. Rejected with `gateway_budget_cycle_anchor_invalid` on `total` and `manual`, which do not cycle.",
    ),
  allow_unreachable: z
    .boolean()
    .optional()
    .describe(
      "Keeps a `team`, `project` or `group` budget that no active key can produce traffic for, which is otherwise refused with `gateway_budget_scope_unreachable`. Send it to provision ahead of the keys that will use the budget. An organization with no active keys is never refused, so this is not needed during first setup.",
    ),
});

const toVkDto = toVirtualKeySnakeDto;

type GatewayContext = Context<{ Variables: AuthMiddlewareVariables }>;

/**
 * The identity this request authorizes as, in the same vocabulary the
 * tRPC layer uses (`virtualKey.authz`), plus the id audit rows record.
 * Scoped API keys act as their owning user; legacy project keys have no
 * user, so they act as the machine principal for their project.
 */
function actorForRequest(c: GatewayContext): {
  actor: VirtualKeyActor;
  actorUserId: string;
} {
  const project = c.get("project");
  const resolved = c.get("resolvedToken");
  if (resolved?.type === "apiKey") {
    return {
      actor: {
        kind: "apiKey",
        apiKeyId: resolved.apiKeyId,
        userId: resolved.userId,
        organizationId: resolved.organizationId,
      },
      actorUserId: resolved.userId ?? machineActorForProject(project.id),
    };
  }
  return {
    actor: { kind: "legacyProjectKey", projectId: project.id },
    actorUserId: machineActorForProject(project.id),
  };
}

/**
 * Read-visibility for a project credential, in the same shape the tRPC
 * list/get procedures use (`isVisibleToMembership`): the credential
 * stands in for someone working in its project, so it sees org-scoped
 * keys, its own team's keys, and its own project's keys — and not a
 * sibling team's.
 */
function membershipForApiCaller(project: Project): MembershipSet {
  return {
    isOrgMember: true,
    isOrgAdmin: false,
    teamIds: new Set([project.teamId]),
    projectIds: new Set([project.id]),
  };
}

const TRPC_HTTP_STATUS: Record<string, ContentfulStatusCode> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  TOO_MANY_REQUESTS: 429,
};

/**
 * Answer `error` as the canonical envelope, with this route family's status.
 *
 * One helper for every refusal a handler raises, so a code path cannot
 * hand-build a body that drifts from {@link apiErrorSchema}.
 */
function errorResponse(
  c: GatewayContext,
  args: {
    status: ContentfulStatusCode;
    code: string;
    message: string;
    meta?: Record<string, unknown>;
  },
): Response {
  return c.json(apiErrorBody({ ...args, ...requestTraceIds(c) }), args.status);
}

/**
 * Map a service-layer TRPCError onto the canonical error envelope. The
 * service messages follow the `snake_code: detail` convention, so the machine
 * code (`trace_project_required`, `group_budget_requires_clickhouse`, …)
 * survives onto the wire for SDKs to branch on. Anything that is not a
 * TRPCError is rethrown for the app-level error handler.
 */
function trpcErrorResponse(c: GatewayContext, error: unknown): Response {
  // The service layer and the shared preconditions raise HandledErrors
  // (ADR-045). They already carry the two things this envelope needs, a
  // stable code and the status to answer with, so read them directly
  // instead of scraping a prefix off the message, which is what the
  // TRPCError branch below has to do.
  if (error instanceof HandledError) {
    return errorResponse(c, {
      status: error.httpStatus as ContentfulStatusCode,
      code: error.code,
      message: error.message,
      // The copy deliberately names no ids -- a mismatched scope id
      // belongs to another tenant -- so `meta` is where the caller
      // learns WHICH of the scopes it sent was the foreign one.
      meta: error.meta,
    });
  }
  if (!(error instanceof TRPCError)) throw error;
  const status = TRPC_HTTP_STATUS[error.code] ?? (500 as ContentfulStatusCode);
  const codeMatch = /^([a-z0-9_]+):/.exec(error.message);
  return errorResponse(c, {
    status,
    code: codeMatch?.[1] ?? error.code.toLowerCase(),
    message: error.message,
  });
}

function validationErrorResponse(
  c: GatewayContext,
  error: z.ZodError,
): Response {
  return errorResponse(c, {
    status: 400,
    code: "validation_error",
    message: error.message,
  });
}

type ScopeInput = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

function scopesFromWire(
  scopes: z.infer<typeof scopeWireSchema>[] | undefined,
  fallbackProjectId: string,
): ScopeInput[] {
  if (!scopes) {
    return [{ scopeType: "PROJECT", scopeId: fallbackProjectId }];
  }
  return scopes.map((s) => ({
    scopeType: toStoredEnum(s.scope_type),
    scopeId: s.scope_id,
  }));
}

/**
 * Translate the snake budget wire onto the SAME schema the tRPC create
 * validates with, so a cap that tRPC would refuse cannot arrive via REST.
 */
function budgetFromWire(
  budget: z.infer<typeof budgetWireSchema> | null | undefined,
): VirtualKeyBudgetInput | null | undefined {
  if (budget === undefined) return undefined;
  if (budget === null) return null;
  const parsed = virtualKeyBudgetInputSchema.safeParse({
    limitUsd:
      typeof budget.limit_usd === "number"
        ? String(budget.limit_usd)
        : budget.limit_usd,
    window: toStoredEnum(budget.window),
    onBreach: budget.on_breach && toStoredEnum(budget.on_breach),
    name: budget.name,
  });
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `validation_error: ${parsed.error.message}`,
    });
  }
  return parsed.data;
}

/**
 * The authorization pre-flight for a virtual key patch, and the scope set the
 * update should apply.
 *
 * The same two gates the tRPC update runs: `virtualKeys:update` on a scope the
 * key ALREADY lives in, plus `virtualKeys:manage` on every NEW scope. Lifted
 * out of the handler so the route body reads as "authorize, then update"
 * rather than interleaving eight awaits with the field mapping.
 */
async function authorizeVirtualKeyUpdate({
  actor,
  service,
  id,
  organizationId,
  fallbackProjectId,
  patch,
}: {
  actor: VirtualKeyActor;
  service: ReturnType<typeof VirtualKeyService.create>;
  id: string;
  organizationId: string;
  fallbackProjectId: string;
  patch: z.infer<typeof updateVirtualKeySchema>;
}): Promise<ScopeInput[] | undefined> {
  const existing = await requireExistingVk(service, id, organizationId);
  await assertActorCanOperateOnAnyScope(
    { prisma, actor },
    existing.scopes,
    "virtualKeys:update",
  );

  const scopes = patch.scopes
    ? scopesFromWire(patch.scopes, fallbackProjectId)
    : undefined;
  if (scopes) {
    await assertActorCanManageAllScopes({ prisma, actor }, scopes);
    await assertScopesBelongToOrg(prisma, organizationId, scopes);
  }

  if (patch.trace_project_id !== undefined) {
    await assertTraceProjectBelongsToOrg(
      prisma,
      organizationId,
      patch.trace_project_id,
    );
    // Re-pointing the destination is the same decision as choosing it at
    // create: it needs manage on the target project.
    if (patch.trace_project_id) {
      await assertActorCanManageAllScopes({ prisma, actor }, [
        { scopeType: "PROJECT", scopeId: patch.trace_project_id },
      ]);
    }
  }

  const vkProjectId = await resolveVkProjectId(prisma, organizationId, {
    vkId: id,
    inputScopes: scopes,
    traceProjectId:
      patch.trace_project_id !== undefined
        ? patch.trace_project_id
        : existing.traceProjectId,
  });
  // Newly-submitted attachments are always validated. A scope change without
  // re-sent config revalidates the existing attachments against the new
  // project; a plain metadata update touches neither.
  const attachmentsToCheck =
    patch.config?.guardrailAttachments ??
    (scopes !== undefined
      ? parseVirtualKeyConfig(existing.config).guardrailAttachments
      : undefined);
  await assertGuardrailAttachmentsAllowed(
    { prisma, actor },
    vkProjectId,
    attachmentsToCheck,
  );

  return scopes;
}

const secured = createProjectApp({
  basePath: "/api/gateway/v1",
  errorEnvelope: "canonical",
});

// ── Virtual keys ────────────────────────────────────────────────────────

secured.access(apiKeyPermission("virtualKeys:view")).get(
  "/virtual-keys",
  describeRoute({
    summary: "List virtual keys",
    description:
      "Returns the virtual keys visible to the caller's project credential: keys scoped to this project, to its team, or to the whole organization. Newest first, paged by cursor: follow `next_cursor` until it comes back null. Visibility is applied to each page after it is read, so a page can hold fewer than `limit` rows without meaning the walk is finished.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Visible virtual keys",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                data: z.array(virtualKeyDtoSchema),
                next_cursor: nextCursorSchema,
              }),
            ),
          },
        },
      },
    },
  }),
  zValidator("query", virtualKeyListQuerySchema),
  async (c) => {
    const project = c.get("project");
    const page = { data: c.req.valid("query") };
    const cursor = createdAtIdCursor(page.data.cursor);
    if (cursor === null) return invalidCursor(c);

    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    const membership = membershipForApiCaller(project);
    const rows = await service.getPage({
      organizationId,
      limit: page.data.limit,
      cursor: cursor ?? null,
      externalId: page.data.external_id,
    });
    // Visibility is applied to the page, not to the query, because
    // `isVisibleToMembership` is the shared implementation the tRPC list uses
    // and a second copy of it in SQL is exactly the drift this app avoids. The
    // cursor therefore advances over rows READ, so a page can be shorter than
    // `limit` without meaning the walk is done.
    return c.json({
      data: rows
        .filter((vk) => isVisibleToMembership(membership, vk.scopes))
        .map(toVkDto),
      next_cursor: nextPageCursor(rows, page.data.limit, (vk) => [
        vk.createdAt.getTime(),
        vk.id,
      ]),
    });
  },
);

secured.access(apiKeyPermission("virtualKeys:create")).post(
  "/virtual-keys",
  describeRoute({
    summary: "Create virtual key",
    description:
      "Mints a new virtual key and returns the secret exactly once. The caller MUST persist the `secret` value, because LangWatch stores only a hash. `scopes` defaults to the caller's project; org- and team-scoped keys require a scoped API key holding `virtualKeys:manage` at each requested scope. An org- or team-scoped key also needs a place for its traces and spend to land, and must say where: pass `trace_project_id` (needs `virtualKeys:manage` on that project). Without it, and without exactly one project scope to take it from, creation refuses with `gateway_trace_project_ambiguous`, because the spend would be attributed to the organization's hidden governance project and counted by no budget on the project you had in mind. An organization whose only project is the governance one is exempt, since there is nothing else to name; one with no governance project either refuses with `trace_project_required`. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including its `secret`, which is the only way to recover a secret whose response was lost in transit.",
    tags: ["Virtual Keys"],
    parameters: [idempotencyKeyParameter],
    responses: {
      ...canonicalBaseResponses,
      ...canonicalConflictResponses,
      201: {
        description: "Virtual key created",
        headers: idempotentReplayHeaders,
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                virtual_key: virtualKeyDtoSchema,
                secret: z.string(),
              }),
            ),
          },
        },
      },
      400: {
        description: "Validation error",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
      403: {
        description: "Caller lacks virtualKeys:manage at a requested scope",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  zValidator("json", createVirtualKeySchema),
  async (c) => {
    const project = c.get("project");
    const body = { data: c.req.valid("json") };
    const idempotencyKey = readIdempotencyKey(
      c.req.header(IDEMPOTENCY_KEY_HEADER),
    );
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const scopes = scopesFromWire(body.data.scopes, project.id);
    const service = VirtualKeyService.create(prisma);
    try {
      // The SAME pre-flight sequence the tRPC create runs, with the actor
      // swapped for the API credential: manage at every requested scope,
      // scopes inside the caller's org, guardrail refs project-local.
      await assertActorCanManageAllScopes({ prisma, actor }, scopes);
      await assertScopesBelongToOrg(prisma, organizationId, scopes);
      await assertTraceProjectBelongsToOrg(
        prisma,
        organizationId,
        body.data.trace_project_id,
      );
      // The destination routes traces AND budget debits into that
      // project, so choosing it needs the same manage grant the old
      // PROJECT scope enforced.
      if (body.data.trace_project_id) {
        await assertActorCanManageAllScopes({ prisma, actor }, [
          { scopeType: "PROJECT", scopeId: body.data.trace_project_id },
        ]);
      }
      const vkProjectId = await resolveVkProjectId(prisma, organizationId, {
        vkId: null,
        inputScopes: scopes,
        traceProjectId: body.data.trace_project_id ?? null,
      });
      await assertGuardrailAttachmentsAllowed(
        { prisma, actor },
        vkProjectId,
        body.data.config?.guardrailAttachments,
      );
      const input: CreateVirtualKeyInput = {
        organizationId,
        name: body.data.name,
        description: body.data.description ?? null,
        principalUserId: body.data.principal_user_id ?? null,
        scopes,
        traceProjectId: body.data.trace_project_id ?? null,
        routingPolicyId: body.data.routing_policy_id ?? null,
        routingMode:
          body.data.routing_mode && toStoredEnum(body.data.routing_mode),
        budget: budgetFromWire(body.data.budget),
        config: body.data.config,
        externalId: body.data.external_id,
        metadata: body.data.metadata,
        actorUserId,
      };
      // Only the create is inside the idempotent section. The pre-flight
      // above is read-only, so leaving it out means a replay still re-checks
      // the caller's scopes rather than trusting a grant it held yesterday.
      const outcome = await withIdempotency({
        prisma,
        operation: "gateway.v1.virtual-keys.create",
        scopeId: project.id,
        key: idempotencyKey,
        validatedBody: body.data,
        handler: async () => {
          const { virtualKey, secret } = await service.create(input);
          logger.info(
            { projectId: project.id, vkId: virtualKey.id },
            "Created virtual key via REST",
          );
          // The secret is minted once and stored only as a hash, so a caller
          // that loses this response has no second way to read it. That is the
          // whole reason this route takes an idempotency key, and the reason
          // the receipt holding this response is encrypted at rest: a replay
          // that withheld the secret would hand back a key nobody can ever
          // use, so the secret has to transit the receipt.
          return {
            status: 201,
            body: { virtual_key: toVkDto(virtualKey), secret },
          };
        },
      });
      return idempotentJson({ c, outcome });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("virtualKeys:view")).get(
  "/virtual-keys/:id",
  describeRoute({
    summary: "Get virtual key",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Virtual key detail",
        content: {
          "application/json": {
            schema: resolver(z.object({ virtual_key: virtualKeyDtoSchema })),
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const service = VirtualKeyService.create(prisma);
    const organizationId = await orgIdForProject(project.id);
    try {
      const vk = await requireVisibleVk(
        service,
        membershipForApiCaller(project),
        { id, organizationId },
      );
      return c.json({ virtual_key: toVkDto(vk) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayUsage:view")).get(
  "/virtual-keys/:id/spend",
  describeRoute({
    summary: "Read a virtual key's spend",
    description:
      "Aggregate spend and request count for one key over a window given in epoch milliseconds (default: current UTC calendar month). Reads the cost path (`trace_summaries`), the same source the dashboard's key list and Usage tab read, so this number, the UI column, and the Usage page agree by construction. Returns 412 `spend_source_unavailable` on deploys without a ClickHouse spend source rather than a $0.00 that cannot be told apart from a zero-spend key.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Spend summary for the key",
        content: {
          "application/json": { schema: resolver(spendSummaryDtoSchema) },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
      412: {
        description: "No spend source on this deployment",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  zValidator("query", vkSpendWindowSchema),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const windowParse = { data: c.req.valid("query") };
    const now = new Date();
    const fromDate =
      windowParse.data.from !== undefined
        ? new Date(windowParse.data.from)
        : startOfCurrentMonthUTC(now);
    const toDate =
      windowParse.data.to !== undefined ? new Date(windowParse.data.to) : now;
    if (fromDate.getTime() >= toDate.getTime()) {
      return errorResponse(c, {
        status: 400,
        code: "validation_error",
        message: "`from` must be before `to`",
      });
    }

    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    let vk;
    try {
      vk = await requireVisibleVk(service, membershipForApiCaller(project), {
        id,
        organizationId,
      });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }

    // Same failure the tRPC spend column raises (spend_source_unavailable):
    // without the ClickHouse spend source there is no number to report, and
    // a confident zero would be indistinguishable from a zero-spend key.
    const spendRepo = getApp().gateway.virtualKeySpend;
    if (!spendRepo) {
      return errorResponse(c, {
        status: 412,
        code: "spend_source_unavailable",
        message:
          "spend_source_unavailable: this deployment has no ClickHouse spend source to read key spend from",
      });
    }

    const usage = GatewayUsageService.create({
      prisma,
      chRepo: undefined,
      spendRepo,
    });
    const spend = await usage.spendByVirtualKey({
      organizationId,
      virtualKeyIds: [vk.id],
      window: { fromDate, toDate },
    });
    const row = spend.get(vk.id);
    return c.json({
      virtual_key_id: vk.id,
      // With the spend source present, a missing row means the key
      // genuinely spent nothing, so zero is the honest render.
      spent_usd: row?.spentUsd ?? "0",
      requests: row?.requests ?? 0,
      window: { from: fromDate.getTime(), to: toDate.getTime() },
    });
  },
);

secured.access(apiKeyPermission("virtualKeys:update")).patch(
  "/virtual-keys/:id",
  describeRoute({
    summary: "Update virtual key",
    description:
      "Partial update: send only the fields you want to change. `scopes` replaces the entire visibility set and requires `virtualKeys:manage` at every NEW scope. `config` is deep-merged. `budget` upserts the key's own cap; explicit null archives it.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: resolver(z.object({ virtual_key: virtualKeyDtoSchema })),
          },
        },
      },
      400: {
        description: "Validation error",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  zValidator("json", updateVirtualKeySchema),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = { data: c.req.valid("json") };
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const service = VirtualKeyService.create(prisma);
    try {
      const scopes = await authorizeVirtualKeyUpdate({
        actor,
        service,
        id,
        organizationId,
        fallbackProjectId: project.id,
        patch: body.data,
      });
      const updated = await service.update({
        id,
        organizationId,
        actorUserId,
        name: body.data.name,
        description: body.data.description,
        scopes,
        traceProjectId: body.data.trace_project_id,
        routingPolicyId: body.data.routing_policy_id,
        routingMode:
          body.data.routing_mode && toStoredEnum(body.data.routing_mode),
        budget: budgetFromWire(body.data.budget),
        config: body.data.config,
        externalId: body.data.external_id,
        metadata: body.data.metadata,
      });
      return c.json({ virtual_key: toVkDto(updated) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("virtualKeys:rotate")).post(
  "/virtual-keys/:id/rotate",
  describeRoute({
    summary: "Rotate virtual key secret",
    description:
      "Mints a fresh secret for an existing VK. The old secret remains valid for 24h (grace window) so in-flight clients can roll over.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Rotated",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                virtual_key: virtualKeyDtoSchema,
                secret: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const service = VirtualKeyService.create(prisma);
    try {
      const existing = await requireExistingVk(service, id, organizationId);
      await assertActorCanOperateOnAnyScope(
        { prisma, actor },
        existing.scopes,
        "virtualKeys:rotate",
      );
      const { virtualKey, secret } = await service.rotate({
        id,
        organizationId,
        actorUserId,
      });
      return c.json({ virtual_key: toVkDto(virtualKey), secret });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("virtualKeys:update")).post(
  "/virtual-keys/:id/disable",
  describeRoute({
    summary: "Disable virtual key",
    // Declared by hand rather than through zValidator because the body is
    // optional here: requiring `{}` to send no operator note would be a worse
    // contract than documenting the shape directly.
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                maxLength: 500,
                description:
                  "Operator note, audit-logged and shown in the key's detail view.",
              },
            },
          },
        },
      },
    },
    description:
      "Reversible stop: requests on the key are rejected with the distinct `virtual_key_disabled` error until it is enabled again. Budgets, scopes, key material, and any rotation grace stay intact. The change propagates through the gateway's change-event feed. Idempotent.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Disabled",
        content: {
          "application/json": {
            schema: resolver(z.object({ virtual_key: virtualKeyDtoSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = disableVkSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const service = VirtualKeyService.create(prisma);
    try {
      const existing = await requireExistingVk(service, id, organizationId);
      await assertActorCanOperateOnAnyScope(
        { prisma, actor },
        existing.scopes,
        "virtualKeys:update",
      );
      const updated = await service.disable({
        id,
        organizationId,
        actorUserId,
        reason: body.data.reason ?? null,
      });
      return c.json({ virtual_key: toVkDto(updated) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("virtualKeys:update")).post(
  "/virtual-keys/:id/enable",
  describeRoute({
    summary: "Enable virtual key",
    description:
      "Reverses disable: the key returns to `active` exactly as it was, including any rotation grace that was running. Idempotent.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Enabled",
        content: {
          "application/json": {
            schema: resolver(z.object({ virtual_key: virtualKeyDtoSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const service = VirtualKeyService.create(prisma);
    try {
      const existing = await requireExistingVk(service, id, organizationId);
      await assertActorCanOperateOnAnyScope(
        { prisma, actor },
        existing.scopes,
        "virtualKeys:update",
      );
      const updated = await service.enable({
        id,
        organizationId,
        actorUserId,
      });
      return c.json({ virtual_key: toVkDto(updated) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("virtualKeys:delete")).post(
  "/virtual-keys/:id/revoke",
  describeRoute({
    summary: "Revoke virtual key",
    description:
      "Marks the virtual key as revoked and archives its own budgets. Clients using it start receiving 401 within ~60s (the gateway's change-event long-poll period). Idempotent.",
    tags: ["Virtual Keys"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Revoked",
        content: {
          "application/json": {
            schema: resolver(z.object({ virtual_key: virtualKeyDtoSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const service = VirtualKeyService.create(prisma);
    try {
      const existing = await requireExistingVk(service, id, organizationId);
      await assertActorCanOperateOnAnyScope(
        { prisma, actor },
        existing.scopes,
        "virtualKeys:delete",
      );
      const updated = await service.revoke({
        id,
        organizationId,
        actorUserId,
      });
      return c.json({ virtual_key: toVkDto(updated) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

// ── Gateway provider bindings ───────────────────────────────────────────

secured.access(apiKeyPermission("gatewayProviders:view")).get(
  "/providers",
  describeRoute({
    summary: "List provider bindings",
    description:
      "Lists every gateway-bound model-provider credential for the caller's project, including health and rate-limit settings.",
    tags: ["Providers"],
    responses: {
      ...canonicalBaseResponses,
      410: {
        description:
          "Gone. Gateway provider bindings folded into ModelProvider in iter 110.",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  async (c) => {
    return errorResponse(c, {
      status: 410,
      code: "gateway_provider_bindings_gone",
      message:
        "Gateway provider bindings folded into ModelProvider in iter 110. Use GET /api/gateway-platform/v1/model-providers or the Advanced (Gateway) tab in the dashboard.",
    });
  },
);

secured.access(apiKeyPermission("gatewayProviders:manage")).post(
  "/providers",
  describeRoute({
    summary: "Bind a model provider to the gateway",
    description:
      "Creates a GatewayProviderCredential binding. Reuses the ModelProvider API key already configured in project settings; this only adds gateway-specific settings (rate limits, rotation, fallback priority).",
    tags: ["Providers"],
    responses: {
      ...canonicalBaseResponses,
      410: {
        description:
          "Gone. Gateway provider bindings folded into ModelProvider in iter 110.",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  async (c) => {
    return errorResponse(c, {
      status: 410,
      code: "gateway_provider_bindings_gone",
      message:
        "Gateway provider bindings folded into ModelProvider in iter 110. Configure rate limits, providerConfig, fallback priority via the Advanced (Gateway) tab on /api/gateway-platform/v1/model-providers/:id.",
    });
  },
);

// ── Budgets ─────────────────────────────────────────────────────────────

secured.access(apiKeyPermission("gatewayBudgets:view")).get(
  "/budgets",
  describeRoute({
    summary: "List budgets",
    description:
      "Returns the non-archived budgets in the caller's organization across all seven scope types (organization / team / project / virtual_key / principal / group / attributed_user), with live `spent_usd` from the spend ledger. Newest first, paged by cursor: follow `next_cursor` until it comes back null. Filter with `scope_type` (comma-separated), which is applied in the query, so `limit` counts rows returned. `group` rows are per-member allowances: `limit_usd` is what EACH member may spend, while `spent_usd` is the group's summed spend, and `member_count` says how many members the allowance currently covers. `attributed_user` rows are per-person templates: `limit_usd` is what EACH end user may spend, `end_users_seen` counts the end users with spend this period, and `end_users_over` how many of them are at or over that limit. A template's own `spent_usd` and `spent_nano_usd` are null because one allowance per person has no single total to report; each person's figure is in `GET /spend-summaries` and the seat buckets. `spend_available: false` means spend could not be totalled at all, and both fields are null for that reason instead, rather than a stale figure a caller could read as real money. Every amount is published twice: `_usd` is the display string, `_nano_usd` is the canonical integer in the same nano-USD unit the spend events carry, so a budget and its spend reconcile without parsing decimals.",
    tags: ["Budgets"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Budgets for the organization",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                data: z.array(budgetDtoSchema),
                spend_available: z.boolean(),
                next_cursor: nextCursorSchema,
              }),
            ),
          },
        },
      },
      400: {
        description: "Invalid scope_type filter",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  zValidator("query", budgetListQuerySchema),
  async (c) => {
    const project = c.get("project");
    const page = { data: c.req.valid("query") };
    const cursor = createdAtIdCursor(page.data.cursor);
    if (cursor === null) return invalidCursor(c);

    const rawFilter = page.data.scope_type;
    let scopeTypes: Set<z.infer<typeof budgetScopeTypeSchema>> | null = null;
    if (rawFilter !== undefined) {
      // Strict: the filter takes the same lowercase values the rows carry.
      // The `.toUpperCase()` that used to sit here was the only dual-casing
      // tolerance on the surface, and it made `scope_type=Group` work while
      // the body's `kind` refused the same spelling.
      const parsed = z
        .array(budgetScopeTypeSchema)
        .min(1)
        .safeParse(rawFilter.split(",").map((s) => s.trim()));
      if (!parsed.success) {
        return c.json(
          {
            error: {
              type: "bad_request",
              code: "validation_error",
              message: `scope_type must be a comma-separated subset of ${budgetScopeTypeSchema.options.join(", ")}`,
            },
          },
          400,
        );
      }
      scopeTypes = new Set(parsed.data);
    }
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayBudgetService.create(
      prisma,
      getApp().gateway.budgets,
    );
    const {
      budgets: rows,
      spendAvailable,
      readAt,
      scopeReach,
    } = await service.listPageWithHealth({
      organizationId,
      limit: page.data.limit,
      cursor: cursor ?? null,
      // Pushed into the query, so `limit` counts rows RETURNED. Filtering the
      // page instead would make a request for 50 group budgets come back with
      // a handful and no way to tell that from the end of the walk.
      scopeTypes: scopeTypes
        ? Array.from(scopeTypes, (t) => toStoredEnum(t))
        : undefined,
      externalId: page.data.external_id,
    });
    const memberCounts = await groupMemberCounts(rows);
    return c.json({
      spend_available: spendAvailable,
      data: rows.map((b) =>
        toBudgetDto({
          budget: b,
          memberCount: memberCounts.get(b.scopeId),
          spendAvailable,
          readAt,
          reachable: scopeReach.get(b.id)?.reachable,
        }),
      ),
      next_cursor: nextPageCursor(rows, page.data.limit, (b) => [
        b.createdAt.getTime(),
        b.id,
      ]),
    });
  },
);

secured.access(apiKeyPermission("gatewayBudgets:view")).get(
  "/budgets/:id",
  describeRoute({
    summary: "Get budget",
    description:
      "One budget, in exactly the row shape `GET /budgets` returns, including the live spend enrichment and the per-person `end_users_seen` / `end_users_over` standing on attributed-user templates. Archived budgets are not returned. `spend_available: false` means spend could not be totalled, and `spent_usd` / `spent_nano_usd` are null rather than a figure that cannot be told apart from zero spend. A per-person template reports null there too, because one allowance per person has no single total; each person's figure is in `GET /spend-summaries` and the seat buckets.",
    tags: ["Budgets"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "The budget",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                budget: budgetDtoSchema,
                spend_available: z.boolean(),
              }),
            ),
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayBudgetService.create(
      prisma,
      getApp().gateway.budgets,
    );
    const found = await service.getWithHealth(id, organizationId);
    if (!found) {
      return errorResponse(c, {
        status: 404,
        code: "budget_not_found",
        message: `budget ${id} not found`,
      });
    }
    const memberCounts = await groupMemberCounts([found.budget]);
    return c.json({
      spend_available: found.spendAvailable,
      budget: toBudgetDto({
        budget: found.budget,
        memberCount: memberCounts.get(found.budget.scopeId),
        spendAvailable: found.spendAvailable,
        readAt: found.readAt,
        reachable: !found.unreachableByAnyKey,
      }),
    });
  },
);

secured.access(apiKeyPermission("gatewayBudgets:create")).post(
  "/budgets",
  describeRoute({
    summary: "Create budget",
    description:
      "Creates an organization-owned budget. The scope discriminates which resource the budget covers, across all seven scope types (organization / team / project / virtual_key / principal / group / attributed_user). `group` budgets are per-member allowances and `attributed_user` budgets are per-end-user templates; both require a deployment with the ClickHouse spend ledger (`group_budget_requires_clickhouse` otherwise). `provider_key` optionally pins the budget to one model provider. `cycle_anchor_at` optionally phases the window off a chosen instant instead of the calendar, for budgets that have to line up with a billing date. A `team`, `project` or `group` budget that none of the organization's active keys can produce traffic for is refused with `gateway_budget_scope_unreachable`, since it would never spend and never block; send `allow_unreachable` to keep it anyway, and note that an organization with no active keys is never refused. Send `Idempotency-Key` to make a retry safe.",
    tags: ["Budgets"],
    parameters: [idempotencyKeyParameter],
    responses: {
      ...canonicalBaseResponses,
      ...canonicalConflictResponses,
      201: {
        description: "Budget created",
        headers: idempotentReplayHeaders,
        content: {
          "application/json": {
            schema: resolver(z.object({ budget: budgetDtoSchema })),
          },
        },
      },
      400: {
        description: "Validation error",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  zValidator("json", createBudgetSchema),
  async (c) => {
    const project = c.get("project");
    const body = { data: c.req.valid("json") };
    // Read before the try: a malformed key is a request-validation failure and
    // takes the same route to the wire as one the schema caught, rather than
    // being reshaped by the service-error mapping below.
    const idempotencyKey = readIdempotencyKey(
      c.req.header(IDEMPOTENCY_KEY_HEADER),
    );
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(
      prisma,
      getApp().gateway.budgets,
    );
    try {
      const outcome = await withIdempotency({
        prisma,
        operation: "gateway.v1.budgets.create",
        scopeId: project.id,
        key: idempotencyKey,
        validatedBody: body.data,
        handler: async () => {
          const row = await service.create({
            organizationId,
            scope: scopeFromWire(body.data.scope),
            name: body.data.name,
            description: body.data.description ?? null,
            window: toStoredEnum(body.data.window),
            limitUsd: body.data.limit_usd,
            onBreach: body.data.on_breach && toStoredEnum(body.data.on_breach),
            timezone: body.data.timezone ?? null,
            providerKey: body.data.provider_key ?? null,
            externalId: body.data.external_id,
            metadata: body.data.metadata,
            cycleAnchorAt: body.data.cycle_anchor_at
              ? new Date(body.data.cycle_anchor_at)
              : null,
            allowUnreachable: body.data.allow_unreachable,
            actorUserId,
          });
          const [memberCounts, reach] = await Promise.all([
            groupMemberCounts([row]),
            service.scopeReach({ organizationId, scope: row }),
          ]);
          return {
            status: 201,
            body: {
              budget: toBudgetDto({
                budget: row,
                memberCount: memberCounts.get(row.scopeId),
                reachable: reach.reachable,
              }),
            },
          };
        },
      });
      return idempotentJson({ c, outcome });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayBudgets:update")).patch(
  "/budgets/:id",
  describeRoute({
    summary: "Update budget",
    description:
      "Partial update. Scope, window and cycle_anchor_at are immutable after create. Use explicit null to clear timezone / description.",
    tags: ["Budgets"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: resolver(z.object({ budget: budgetDtoSchema })),
          },
        },
      },
    },
  }),
  zValidator("json", updateBudgetSchema),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = { data: c.req.valid("json") };
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(
      prisma,
      getApp().gateway.budgets,
    );
    try {
      const row = await service.update({
        id,
        organizationId,
        name: body.data.name,
        description: body.data.description,
        limitUsd: body.data.limit_usd,
        onBreach: body.data.on_breach && toStoredEnum(body.data.on_breach),
        timezone: body.data.timezone,
        externalId: body.data.external_id,
        metadata: body.data.metadata,
        actorUserId,
      });
      const memberCounts = await groupMemberCounts([row]);
      return c.json({
        budget: toBudgetDto({
          budget: row,
          memberCount: memberCounts.get(row.scopeId),
        }),
      });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayBudgets:delete")).delete(
  "/budgets/:id",
  describeRoute({
    summary: "Archive budget",
    description:
      "Soft-delete: the row is marked archived and no longer counted by the budget engine. Historical ledger entries are retained.",
    tags: ["Budgets"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Archived",
        content: {
          "application/json": {
            schema: resolver(z.object({ budget: budgetDtoSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(
      prisma,
      getApp().gateway.budgets,
    );
    try {
      const row = await service.archive({
        id,
        organizationId,
        actorUserId,
      });
      return c.json({ budget: toBudgetDto({ budget: row }) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayBudgets:update")).post(
  "/budgets/:id/reset",
  describeRoute({
    summary: "Reset budget period",
    // Declared by hand rather than through zValidator because the body is
    // optional here: requiring `{}` to send no operator note would be a worse
    // contract than documenting the shape directly.
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                maxLength: 500,
                description:
                  "Free-text operator note, audit-logged with the reset.",
              },
            },
          },
        },
      },
    },
    description:
      "Moves the budget's period boundary to now and recomputes the next reset; recorded spend is NEVER mutated (the ledger and every emitted billing event are immutable, so reconciliation is unaffected). On calendar windows this truncates the running period and the next boundary stays calendar; on `manual` windows the new period stays open until the next reset. For attributed-user templates, `end_user_id` resets ONE end-user bucket's boundary and leaves the template period untouched.",
    tags: ["Budgets"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Reset",
        content: {
          "application/json": {
            schema: resolver(z.object({ budget: budgetDtoSchema })),
          },
        },
      },
    },
  }),
  zValidator("query", resetBudgetQuerySchema),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const endUserId = c.req.valid("query").end_user_id ?? null;
    // The body is OPTIONAL on this route and on /disable: a reset with no
    // operator note is the common case, and requiring `{}` to send nothing
    // would be a worse contract than documenting the body by hand. Both keep
    // manual parsing for that reason, and declare their `requestBody` in
    // describeRoute so the spec still shows it.
    const body = resetBudgetSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(
      prisma,
      getApp().gateway.budgets,
    );
    try {
      const row = await service.reset({
        id,
        organizationId,
        actorUserId,
        endUserId,
        reason: body.data.reason ?? null,
      });
      const memberCounts = await groupMemberCounts([row]);
      return c.json({
        budget: toBudgetDto({
          budget: row,
          memberCount: memberCounts.get(row.scopeId),
        }),
      });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayProviders:update")).patch(
  "/providers/:id",
  describeRoute({
    summary: "Update provider binding",
    description:
      "Partial update of gateway-specific settings (rate limits, rotation, slot, extra headers). The underlying ModelProvider credentials are managed in project settings, not here.",
    tags: ["Providers"],
    responses: {
      ...canonicalBaseResponses,
      410: {
        description:
          "Gone. Gateway provider bindings folded into ModelProvider in iter 110.",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  async (c) => {
    return errorResponse(c, {
      status: 410,
      code: "gateway_provider_bindings_gone",
      message:
        "Gateway provider bindings folded into ModelProvider in iter 110. PATCH the advanced fields via PATCH /api/gateway-platform/v1/model-providers/:id.",
    });
  },
);

secured.access(apiKeyPermission("gatewayProviders:manage")).delete(
  "/providers/:id",
  describeRoute({
    summary: "Disable provider binding",
    description:
      "Marks the binding disabled. Requests routing to this slot are skipped (fallback chain continues). Historical ledger rows are retained.",
    tags: ["Providers"],
    responses: {
      ...canonicalBaseResponses,
      410: {
        description:
          "Gone. Gateway provider bindings folded into ModelProvider in iter 110.",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  async (c) => {
    return errorResponse(c, {
      status: 410,
      code: "gateway_provider_bindings_gone",
      message:
        "Gateway provider bindings folded into ModelProvider in iter 110. Disable the underlying ModelProvider via DELETE /api/gateway-platform/v1/model-providers/:id (soft-disable).",
    });
  },
);

// ── Cache-control rules ────────────────────────────────────────────────

secured.access(apiKeyPermission("gatewayCacheRules:view")).get(
  "/cache-rules",
  describeRoute({
    summary: "List cache-control rules",
    description:
      "Organization-scoped operator-authored rules, sorted priority descending then oldest first, with archived rules excluded. Paged by cursor: follow `next_cursor` until it comes back null. Matchers and action are returned verbatim as JSON.",
    tags: ["Cache Rules"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Cache rules for the organisation",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                data: z.array(cacheRuleDtoSchema),
                next_cursor: nextCursorSchema,
              }),
            ),
          },
        },
      },
    },
  }),
  zValidator("query", pageQuerySchema),
  async (c) => {
    const project = c.get("project");
    const page = { data: c.req.valid("query") };
    const cursor = cacheRuleCursor(page.data.cursor);
    if (cursor === null) return invalidCursor(c);

    const organizationId = await orgIdForProject(project.id);
    const service = GatewayCacheRuleService.create(prisma);
    const rows = await service.listPage({
      organizationId,
      limit: page.data.limit,
      cursor: cursor ?? null,
    });
    return c.json({
      data: rows.map(toCacheRuleDto),
      next_cursor: nextPageCursor(rows, page.data.limit, (r) => [
        r.priority,
        r.createdAt.getTime(),
        r.id,
      ]),
    });
  },
);

secured.access(apiKeyPermission("gatewayCacheRules:view")).get(
  "/cache-rules/:id",
  describeRoute({
    summary: "Get a cache rule",
    description:
      "Returns the rule if it belongs to the caller's organisation; 404 otherwise. Archived rules are NOT returned (use the audit log to inspect removed rules).",
    tags: ["Cache Rules"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "The rule",
        content: {
          "application/json": {
            schema: resolver(z.object({ cache_rule: cacheRuleDtoSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayCacheRuleService.create(prisma);
    const row = await service.get(id, organizationId);
    if (!row) {
      return errorResponse(c, {
        status: 404,
        code: "cache_rule_not_found",
        message: `cache rule ${id} not found`,
      });
    }
    return c.json({ cache_rule: toCacheRuleDto(row) });
  },
);

secured.access(apiKeyPermission("gatewayCacheRules:create")).post(
  "/cache-rules",
  describeRoute({
    summary: "Create a cache rule",
    description:
      "Matchers are ANDed across non-null fields; at least one matcher is required. Mode is one of respect/force/disable. TTL is clamped to [0, 86400]. Salt is an optional cache-bust tag (max 64 chars). All writes emit a ChangeEvent so the gateway picks up the new rule within 30 s via its /changes long-poll. Send `Idempotency-Key` to make a retry safe.",
    tags: ["Cache Rules"],
    parameters: [idempotencyKeyParameter],
    responses: {
      ...canonicalBaseResponses,
      ...canonicalConflictResponses,
      201: {
        description: "Created",
        headers: idempotentReplayHeaders,
        content: {
          "application/json": {
            schema: resolver(z.object({ cache_rule: cacheRuleDtoSchema })),
          },
        },
      },
      400: {
        description: "Validation error",
        content: {
          "application/json": { schema: resolver(apiErrorSchema) },
        },
      },
    },
  }),
  zValidator("json", createCacheRuleSchema),
  async (c) => {
    const project = c.get("project");
    const body = { data: c.req.valid("json") };
    const idempotencyKey = readIdempotencyKey(
      c.req.header(IDEMPOTENCY_KEY_HEADER),
    );
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayCacheRuleService.create(prisma);
    try {
      const outcome = await withIdempotency({
        prisma,
        operation: "gateway.v1.cache-rules.create",
        scopeId: project.id,
        key: idempotencyKey,
        validatedBody: body.data,
        handler: async () => {
          const row = await service.create({
            organizationId,
            name: body.data.name,
            description: body.data.description ?? null,
            priority: body.data.priority,
            enabled: body.data.enabled,
            matchers: body.data.matchers,
            action: body.data.action,
            actorUserId,
          });
          return { status: 201, body: { cache_rule: toCacheRuleDto(row) } };
        },
      });
      return idempotentJson({ c, outcome });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayCacheRules:update")).patch(
  "/cache-rules/:id",
  describeRoute({
    summary: "Update a cache rule",
    description:
      "Partial update. `matchers` and `action` REPLACE the stored value when provided (not merged field-by-field). Omitting them leaves the stored value untouched. The rule id + organisation are immutable.",
    tags: ["Cache Rules"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: resolver(z.object({ cache_rule: cacheRuleDtoSchema })),
          },
        },
      },
    },
  }),
  zValidator("json", updateCacheRuleSchema),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = { data: c.req.valid("json") };
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayCacheRuleService.create(prisma);
    try {
      const row = await service.update({
        id,
        organizationId,
        name: body.data.name,
        description: body.data.description,
        priority: body.data.priority,
        enabled: body.data.enabled,
        matchers: body.data.matchers,
        action: body.data.action,
        actorUserId,
      });
      return c.json({ cache_rule: toCacheRuleDto(row) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayCacheRules:delete")).delete(
  "/cache-rules/:id",
  describeRoute({
    summary: "Archive a cache rule",
    description:
      "Soft-delete: sets archivedAt. The rule stops matching new requests. Audit log retains before/after snapshots. Returns the archived row.",
    tags: ["Cache Rules"],
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Archived",
        content: {
          "application/json": {
            schema: resolver(z.object({ cache_rule: cacheRuleDtoSchema })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayCacheRuleService.create(prisma);
    try {
      const row = await service.archive({
        id,
        organizationId,
        actorUserId,
      });
      return c.json({ cache_rule: toCacheRuleDto(row) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

function toCacheRuleDto(r: GatewayCacheRule) {
  return {
    id: r.id,
    organization_id: r.organizationId,
    name: r.name,
    description: r.description,
    priority: r.priority,
    enabled: r.enabled,
    matchers: r.matchers as Record<string, unknown>,
    action: r.action as {
      mode: "respect" | "force" | "disable";
      ttl?: number;
      salt?: string;
    },
    mode_enum: toWireEnum(r.modeEnum),
    archived_at: r.archivedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/**
 * Member counts for GROUP-scoped rows, so the wire can say how many
 * members a per-member allowance currently covers. One batched query for
 * however many GROUP rows the response carries; empty map otherwise.
 */
async function groupMemberCounts(
  budgets: Array<{ scopeType: string; scopeId: string }>,
): Promise<Map<string, number>> {
  const groupIds = Array.from(
    new Set(
      budgets.filter((b) => b.scopeType === "GROUP").map((b) => b.scopeId),
    ),
  );
  if (groupIds.length === 0) return new Map();
  const groups = await prisma.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true, _count: { select: { members: true } } },
  });
  return new Map(groups.map((g) => [g.id, g._count.members]));
}

function scopeFromWire(
  scope: z.infer<typeof createBudgetSchema>["scope"],
): BudgetScope {
  switch (scope.kind) {
    case "organization":
      return { kind: "ORGANIZATION", organizationId: scope.organization_id };
    case "team":
      return { kind: "TEAM", teamId: scope.team_id };
    case "project":
      return { kind: "PROJECT", projectId: scope.project_id };
    case "virtual_key":
      return { kind: "VIRTUAL_KEY", virtualKeyId: scope.virtual_key_id };
    case "principal":
      return { kind: "PRINCIPAL", principalUserId: scope.principal_user_id };
    case "group":
      return { kind: "GROUP", groupId: scope.group_id };
    case "attributed_user":
      return {
        kind: "ATTRIBUTED_USER",
        anchorVirtualKeyId: scope.anchor_virtual_key_id,
        anchorProjectId: scope.anchor_project_id,
      };
  }
}

/**
 * Machine-principal actor id used for audit logs on writes from legacy
 * project keys, which carry no user. Uses the project id so audit entries
 * can still be traced back to the originating credential. Scoped API keys
 * do not use this — they act as their owning user (see `actorForRequest`).
 */
function machineActorForProject(projectId: string): string {
  return `svc_${projectId}`;
}

export const app = secured.hono;
