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
import type { GatewayBudget, GatewayCacheRule, Project } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import type { AuthMiddlewareVariables } from "~/app/api/middleware/auth";
import { apiKeyPermission, createProjectApp } from "~/server/api/security";
import { prisma } from "~/server/db";
import {
  type BudgetScope,
  GatewayBudgetService,
} from "~/server/gateway/budget.service";
import { GatewayCacheRuleService } from "~/server/gateway/cacheRule.service";
import {
  chRepoOrUndefined,
  spendRepoOrUndefined,
} from "~/server/gateway/clickhouseRepos";
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
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";

const logger = createLogger("langwatch:api:gateway-platform");

patchZodOpenapi();

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// These mirror the shapes returned by toVirtualKeySnakeDto / budget DTO /
// cache-rule DTO. Kept in-file to stay a single source of truth per app.

const virtualKeyDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["active", "revoked"]),
  purpose: z.enum(["user", "langy"]),
  display_prefix: z.string(),
  principal_user_id: z.string().nullable(),
  // Where an org- or team-owned key's traces and costs land. Not a
  // scope: it grants no access to the key.
  trace_project_id: z.string().nullable(),
  scopes: z.array(z.object({ scope_type: z.string(), scope_id: z.string() })),
  routing_policy_id: z.string().nullable(),
  routing_mode: z.enum(["NONE", "FALLBACK_ALL", "POLICY"]),
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
  scope_type: z.enum([
    "ORGANIZATION",
    "TEAM",
    "PROJECT",
    "VIRTUAL_KEY",
    "PRINCIPAL",
    "GROUP",
    "ATTRIBUTED_USER",
  ]),
  scope_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  window: z.string(),
  on_breach: z.enum(["BLOCK", "WARN"]),
  limit_usd: z.string(),
  spent_usd: z.string(),
  timezone: z.string().nullable(),
  provider_key: z.string().nullable(),
  current_period_started_at: z.string(),
  resets_at: z.string(),
  last_reset_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  member_count: z.number().int().optional(),
});

const spendSummaryDtoSchema = z.object({
  virtual_key_id: z.string(),
  spent_usd: z.string(),
  requests: z.number().int(),
  window: z.object({ from: z.string(), to: z.string() }),
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
  mode_enum: z.enum(["RESPECT", "FORCE", "DISABLE"]),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const errorSchema = z.object({
  error: z.object({
    type: z.string(),
    code: z.string(),
    message: z.string(),
    /** Present when the refusal carries structured detail, e.g. `scopeKind`. */
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
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

// ── Request wire schemas ────────────────────────────────────────────────

const scopeWireSchema = z.object({
  scope_type: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
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
  window: z.enum(["DAY", "WEEK", "MONTH"]),
  on_breach: z.enum(["BLOCK", "WARN"]).optional(),
  name: z.string().min(1).max(128).optional(),
});

const routingModeWireSchema = z.enum(["NONE", "FALLBACK_ALL", "POLICY"]);

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
  on_breach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
});

const budgetScopeTypeSchema = z.enum([
  "ORGANIZATION",
  "TEAM",
  "PROJECT",
  "VIRTUAL_KEY",
  "PRINCIPAL",
  "GROUP",
  "ATTRIBUTED_USER",
]);

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
    z.object({ kind: z.literal("ORGANIZATION"), organization_id: z.string() }),
    z.object({ kind: z.literal("TEAM"), team_id: z.string() }),
    z.object({ kind: z.literal("PROJECT"), project_id: z.string() }),
    z.object({ kind: z.literal("VIRTUAL_KEY"), virtual_key_id: z.string() }),
    z.object({ kind: z.literal("PRINCIPAL"), principal_user_id: z.string() }),
    // Per-member group budgets. Creation is service-guarded: it needs the
    // ClickHouse spend path (group_budget_requires_clickhouse otherwise).
    z.object({ kind: z.literal("GROUP"), group_id: z.string() }),
    // Per-end-user template on an anchor (exactly one of the two ids).
    // Service-guarded like GROUP: per-user buckets need the spend ledger.
    z.object({
      kind: z.literal("ATTRIBUTED_USER"),
      anchor_virtual_key_id: z.string().optional(),
      anchor_project_id: z.string().optional(),
    }),
  ]),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  window: z.enum(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL", "MANUAL"]),
  limit_usd: usdAmountSchema,
  on_breach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
  /**
   * ModelProvider row id the budget counts and constrains. Null / absent
   * counts every provider. Orthogonal to the scope target, which is what
   * makes the full target x provider matrix expressible.
   */
  provider_key: z.string().nullable().optional(),
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

const ERROR_TYPE_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "permission_denied",
  404: "not_found",
  409: "conflict",
  412: "precondition_failed",
  429: "rate_limited",
};

/**
 * Map a service-layer TRPCError onto the REST error envelope. The service
 * messages follow the `snake_code: detail` convention, so the machine
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
    const status = error.httpStatus as ContentfulStatusCode;
    return c.json(
      {
        error: {
          type: ERROR_TYPE_BY_STATUS[status] ?? "internal_error",
          code: error.code,
          message: error.message,
          // The copy deliberately names no ids -- a mismatched scope id
          // belongs to another tenant -- so `meta` is where the caller
          // learns WHICH of the scopes it sent was the foreign one.
          ...(error.meta && Object.keys(error.meta).length > 0
            ? { meta: error.meta }
            : {}),
        },
      },
      status,
    );
  }
  if (!(error instanceof TRPCError)) throw error;
  const status = TRPC_HTTP_STATUS[error.code] ?? (500 as ContentfulStatusCode);
  const codeMatch = /^([a-z0-9_]+):/.exec(error.message);
  return c.json(
    {
      error: {
        type: ERROR_TYPE_BY_STATUS[status] ?? "internal_error",
        code: codeMatch?.[1] ?? error.code.toLowerCase(),
        message: error.message,
      },
    },
    status,
  );
}

function validationErrorResponse(
  c: GatewayContext,
  error: z.ZodError,
): Response {
  return c.json(
    {
      error: {
        type: "bad_request",
        code: "validation_error",
        message: error.message,
      },
    },
    400,
  );
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
  return scopes.map((s) => ({ scopeType: s.scope_type, scopeId: s.scope_id }));
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
    window: budget.window,
    onBreach: budget.on_breach,
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

const secured = createProjectApp({ basePath: "/api/gateway/v1" });

// ── Virtual keys ────────────────────────────────────────────────────────

secured.access(apiKeyPermission("virtualKeys:view")).get(
  "/virtual-keys",
  describeRoute({
    summary: "List virtual keys",
    description:
      "Returns every virtual key visible to the caller's project credential: keys scoped to this project, to its team, or to the whole organization. Ordered by creation time.",
    tags: ["Virtual Keys"],
    responses: {
      ...baseResponses,
      200: {
        description: "Visible virtual keys",
        content: {
          "application/json": {
            schema: resolver(z.object({ data: z.array(virtualKeyDtoSchema) })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const organizationId = await orgIdForProject(project.id);
    const service = VirtualKeyService.create(prisma);
    const membership = membershipForApiCaller(project);
    const rows = (await service.getAll(organizationId)).filter((vk) =>
      isVisibleToMembership(membership, vk.scopes),
    );
    return c.json({ data: rows.map(toVkDto) });
  },
);

secured.access(apiKeyPermission("virtualKeys:create")).post(
  "/virtual-keys",
  describeRoute({
    summary: "Create virtual key",
    description:
      "Mints a new virtual key and returns the secret exactly once. The caller MUST persist the `secret` value — LangWatch stores only a hash. `scopes` defaults to the caller's project; org- and team-scoped keys require a scoped API key holding `virtualKeys:manage` at each requested scope. An org- or team-scoped key also needs a place for its traces and spend to land: pass `trace_project_id` (needs `virtualKeys:manage` on that project), or the organization's governance project is used, and creation refuses with `trace_project_required` when neither exists.",
    tags: ["Virtual Keys"],
    responses: {
      ...baseResponses,
      201: {
        description: "Virtual key created",
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
          "application/json": { schema: resolver(errorSchema) },
        },
      },
      403: {
        description: "Caller lacks virtualKeys:manage at a requested scope",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const body = createVirtualKeySchema.safeParse(await c.req.json());
    if (!body.success) return validationErrorResponse(c, body.error);
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
        routingMode: body.data.routing_mode,
        budget: budgetFromWire(body.data.budget),
        config: body.data.config,
        actorUserId,
      };
      const { virtualKey, secret } = await service.create(input);
      logger.info(
        { projectId: project.id, vkId: virtualKey.id },
        "Created virtual key via REST",
      );
      // Secret is returned exactly once — caller MUST persist it.
      return c.json({ virtual_key: toVkDto(virtualKey), secret }, 201);
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
      ...baseResponses,
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
          "application/json": { schema: resolver(errorSchema) },
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
      "Aggregate spend and request count for one key over a window (default: current UTC calendar month). Reads the cost path (`trace_summaries`) — the same source the dashboard's key list and Usage tab read — so this number, the UI column, and the Usage page agree by construction. Returns 412 `spend_source_unavailable` on deploys without a ClickHouse spend source rather than a $0.00 that cannot be told apart from a zero-spend key.",
    tags: ["Virtual Keys"],
    responses: {
      ...baseResponses,
      200: {
        description: "Spend summary for the key",
        content: {
          "application/json": { schema: resolver(spendSummaryDtoSchema) },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
      412: {
        description: "No spend source on this deployment",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const windowParse = z
      .object({
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
      })
      .safeParse({
        from: c.req.query("from"),
        to: c.req.query("to"),
      });
    if (!windowParse.success) {
      return validationErrorResponse(c, windowParse.error);
    }
    const now = new Date();
    const fromDate = windowParse.data.from
      ? new Date(windowParse.data.from)
      : startOfCurrentMonthUTC(now);
    const toDate = windowParse.data.to ? new Date(windowParse.data.to) : now;
    if (fromDate.getTime() >= toDate.getTime()) {
      return c.json(
        {
          error: {
            type: "bad_request",
            code: "validation_error",
            message: "`from` must be before `to`",
          },
        },
        400,
      );
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
    const spendRepo = spendRepoOrUndefined();
    if (!spendRepo) {
      return c.json(
        {
          error: {
            type: "precondition_failed",
            code: "spend_source_unavailable",
            message:
              "spend_source_unavailable: this deployment has no ClickHouse spend source to read key spend from",
          },
        },
        412,
      );
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
      window: { from: fromDate.toISOString(), to: toDate.toISOString() },
    });
  },
);

secured.access(apiKeyPermission("virtualKeys:update")).patch(
  "/virtual-keys/:id",
  describeRoute({
    summary: "Update virtual key",
    description:
      "Partial update — send only the fields you want to change. `scopes` replaces the entire visibility set and requires `virtualKeys:manage` at every NEW scope. `config` is deep-merged. `budget` upserts the key's own cap; explicit null archives it.",
    tags: ["Virtual Keys"],
    responses: {
      ...baseResponses,
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
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = updateVirtualKeySchema.safeParse(await c.req.json());
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actor, actorUserId } = actorForRequest(c);
    const service = VirtualKeyService.create(prisma);
    try {
      const existing = await requireExistingVk(service, id, organizationId);
      // Mutating an existing key needs virtualKeys:update on one of the
      // scopes it already lives in; re-scoping additionally needs manage
      // on every NEW scope — the same two gates as the tRPC update.
      await assertActorCanOperateOnAnyScope(
        { prisma, actor },
        existing.scopes,
        "virtualKeys:update",
      );
      const scopes = body.data.scopes
        ? scopesFromWire(body.data.scopes, project.id)
        : undefined;
      if (scopes) {
        await assertActorCanManageAllScopes({ prisma, actor }, scopes);
        await assertScopesBelongToOrg(prisma, organizationId, scopes);
      }
      if (body.data.trace_project_id !== undefined) {
        await assertTraceProjectBelongsToOrg(
          prisma,
          organizationId,
          body.data.trace_project_id,
        );
        // Re-pointing the destination is the same decision as choosing
        // it at create: it needs manage on the target project.
        if (body.data.trace_project_id) {
          await assertActorCanManageAllScopes({ prisma, actor }, [
            { scopeType: "PROJECT", scopeId: body.data.trace_project_id },
          ]);
        }
      }
      const vkProjectId = await resolveVkProjectId(prisma, organizationId, {
        vkId: id,
        inputScopes: scopes,
        traceProjectId:
          body.data.trace_project_id !== undefined
            ? body.data.trace_project_id
            : existing.traceProjectId,
      });
      // Newly-submitted attachments are always validated. A scope change
      // without re-sent config revalidates the existing attachments
      // against the new project; a plain metadata update touches neither.
      const attachmentsToCheck =
        body.data.config?.guardrailAttachments ??
        (scopes !== undefined
          ? parseVirtualKeyConfig(existing.config).guardrailAttachments
          : undefined);
      await assertGuardrailAttachmentsAllowed(
        { prisma, actor },
        vkProjectId,
        attachmentsToCheck,
      );
      const updated = await service.update({
        id,
        organizationId,
        actorUserId,
        name: body.data.name,
        description: body.data.description,
        scopes,
        traceProjectId: body.data.trace_project_id,
        routingPolicyId: body.data.routing_policy_id,
        routingMode: body.data.routing_mode,
        budget: budgetFromWire(body.data.budget),
        config: body.data.config,
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
      ...baseResponses,
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
    description:
      "Reversible stop: requests on the key are rejected with the distinct `virtual_key_disabled` error until it is enabled again. Budgets, scopes, key material, and any rotation grace stay intact. The change propagates through the gateway's change-event feed. Idempotent.",
    tags: ["Virtual Keys"],
    responses: {
      ...baseResponses,
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
      "Reverses disable: the key returns to ACTIVE exactly as it was, including any rotation grace that was running. Idempotent.",
    tags: ["Virtual Keys"],
    responses: {
      ...baseResponses,
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
      ...baseResponses,
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
      ...baseResponses,
      200: {
        description: "Provider bindings",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                data: z.array(
                  z.object({
                    id: z.string(),
                    model_provider_id: z.string(),
                    model_provider_name: z.string(),
                    slot: z.string(),
                    rate_limit_rpm: z.number().nullable(),
                    rate_limit_tpm: z.number().nullable(),
                    rate_limit_rpd: z.number().nullable(),
                    rotation_policy: z.string(),
                    fallback_priority_global: z.number().nullable(),
                    health_status: z.string(),
                    disabled_at: z.string().nullable(),
                    created_at: z.string(),
                  }),
                ),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json(
      {
        error: "gone",
        message:
          "Gateway provider bindings folded into ModelProvider in iter 110. Use GET /api/gateway-platform/v1/model-providers or the Advanced (Gateway) tab in the dashboard.",
      },
      410,
    );
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
      ...baseResponses,
      201: {
        description: "Binding created",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                provider_credential: z.object({ id: z.string() }),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json(
      {
        error: "gone",
        message:
          "Gateway provider bindings folded into ModelProvider in iter 110. Configure rate limits, providerConfig, fallback priority via the Advanced (Gateway) tab on /api/gateway-platform/v1/model-providers/:id.",
      },
      410,
    );
  },
);

// ── Budgets ─────────────────────────────────────────────────────────────

secured.access(apiKeyPermission("gatewayBudgets:view")).get(
  "/budgets",
  describeRoute({
    summary: "List budgets",
    description:
      "Returns every non-archived budget in the caller's organization across all six scope types (organization / team / project / virtual_key / principal / group), with live `spent_usd` from the spend ledger. Filter with `scope_type` (comma-separated). GROUP rows are per-member allowances: `limit_usd` is what EACH member may spend, while `spent_usd` is the group's summed spend, and `member_count` says how many members the allowance currently covers. `spend_available: false` means spend could not be totalled and `spent_usd` must not be read as real spend.",
    tags: ["Budgets"],
    responses: {
      ...baseResponses,
      200: {
        description: "Budgets for the organization",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                data: z.array(budgetDtoSchema),
                spend_available: z.boolean(),
              }),
            ),
          },
        },
      },
      400: {
        description: "Invalid scope_type filter",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const rawFilter = c.req.query("scope_type");
    let scopeTypes: Set<z.infer<typeof budgetScopeTypeSchema>> | null = null;
    if (rawFilter !== undefined) {
      const parsed = z
        .array(budgetScopeTypeSchema)
        .min(1)
        .safeParse(rawFilter.split(",").map((s) => s.trim().toUpperCase()));
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
    const service = GatewayBudgetService.create(prisma, chRepoOrUndefined());
    const { budgets, spendAvailable } =
      await service.listWithHealth(organizationId);
    const rows = scopeTypes
      ? budgets.filter((b) => scopeTypes.has(b.scopeType))
      : budgets;
    const memberCounts = await groupMemberCounts(rows);
    return c.json({
      spend_available: spendAvailable,
      data: rows.map((b) => toBudgetDto(b, memberCounts.get(b.scopeId))),
    });
  },
);

secured.access(apiKeyPermission("gatewayBudgets:create")).post(
  "/budgets",
  describeRoute({
    summary: "Create budget",
    description:
      "Creates an organization-owned budget. The scope discriminates which resource the budget covers (organization / team / project / virtual_key / principal / group). GROUP budgets are per-member allowances and require a deployment with the ClickHouse spend ledger (`group_budget_requires_clickhouse` otherwise). `provider_key` optionally pins the budget to one model provider.",
    tags: ["Budgets"],
    responses: {
      ...baseResponses,
      201: {
        description: "Budget created",
        content: {
          "application/json": {
            schema: resolver(z.object({ budget: budgetDtoSchema })),
          },
        },
      },
      400: {
        description: "Validation error",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const body = createBudgetSchema.safeParse(await c.req.json());
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(prisma, chRepoOrUndefined());
    try {
      const row = await service.create({
        organizationId,
        scope: scopeFromWire(body.data.scope),
        name: body.data.name,
        description: body.data.description ?? null,
        window: body.data.window,
        limitUsd: body.data.limit_usd,
        onBreach: body.data.on_breach,
        timezone: body.data.timezone ?? null,
        providerKey: body.data.provider_key ?? null,
        actorUserId,
      });
      const memberCounts = await groupMemberCounts([row]);
      return c.json(
        { budget: toBudgetDto(row, memberCounts.get(row.scopeId)) },
        201,
      );
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
      "Partial update — scope and window are immutable after create. Use explicit null to clear timezone / description.",
    tags: ["Budgets"],
    responses: {
      ...baseResponses,
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
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = updateBudgetSchema.safeParse(await c.req.json());
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(prisma, chRepoOrUndefined());
    try {
      const row = await service.update({
        id,
        organizationId,
        name: body.data.name,
        description: body.data.description,
        limitUsd: body.data.limit_usd,
        onBreach: body.data.on_breach,
        timezone: body.data.timezone,
        actorUserId,
      });
      const memberCounts = await groupMemberCounts([row]);
      return c.json({
        budget: toBudgetDto(row, memberCounts.get(row.scopeId)),
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
      "Soft-delete — the row is marked archived and no longer counted by the budget engine. Historical ledger entries are retained.",
    tags: ["Budgets"],
    responses: {
      ...baseResponses,
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
    const service = GatewayBudgetService.create(prisma, chRepoOrUndefined());
    try {
      const row = await service.archive({
        id,
        organizationId,
        actorUserId,
      });
      return c.json({ budget: toBudgetDto(row) });
    } catch (error) {
      return trpcErrorResponse(c, error);
    }
  },
);

secured.access(apiKeyPermission("gatewayBudgets:update")).post(
  "/budgets/:id/reset",
  describeRoute({
    summary: "Reset budget period",
    description:
      "Moves the budget's period boundary to now and recomputes the next reset; recorded spend is NEVER mutated (the ledger and every emitted billing event are immutable, so reconciliation is unaffected). On calendar windows this truncates the running period and the next boundary stays calendar; on MANUAL windows the new period stays open until the next reset. For attributed-user templates, `end_user_id` resets ONE end-user bucket's boundary and leaves the template period untouched.",
    tags: ["Budgets"],
    responses: {
      ...baseResponses,
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
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const endUserId = c.req.query("end_user_id") ?? null;
    const body = resetBudgetSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayBudgetService.create(prisma, chRepoOrUndefined());
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
        budget: toBudgetDto(row, memberCounts.get(row.scopeId)),
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
      ...baseResponses,
      200: {
        description: "Updated",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                provider_credential: z.object({ id: z.string() }),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json(
      {
        error: "gone",
        message:
          "Gateway provider bindings folded into ModelProvider in iter 110. PATCH the advanced fields via PATCH /api/gateway-platform/v1/model-providers/:id.",
      },
      410,
    );
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
      ...baseResponses,
      200: {
        description: "Disabled",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                provider_credential: z.object({
                  id: z.string(),
                  disabled_at: z.string().nullable(),
                }),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json(
      {
        error: "gone",
        message:
          "Gateway provider bindings folded into ModelProvider in iter 110. Disable the underlying ModelProvider via DELETE /api/gateway-platform/v1/model-providers/:id (soft-disable).",
      },
      410,
    );
  },
);

// ── Cache-control rules ────────────────────────────────────────────────

secured.access(apiKeyPermission("gatewayCacheRules:view")).get(
  "/cache-rules",
  describeRoute({
    summary: "List cache-control rules",
    description:
      "Organization-scoped operator-authored rules. Returned sorted priority DESC; archived rules excluded. Matchers and action are returned verbatim as JSON.",
    tags: ["Cache Rules"],
    responses: {
      ...baseResponses,
      200: {
        description: "Cache rules for the organisation",
        content: {
          "application/json": {
            schema: resolver(z.object({ data: z.array(cacheRuleDtoSchema) })),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const organizationId = await orgIdForProject(project.id);
    const service = GatewayCacheRuleService.create(prisma);
    const rows = await service.list(organizationId);
    return c.json({ data: rows.map(toCacheRuleDto) });
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
      ...baseResponses,
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
      return c.json(
        {
          error: {
            type: "not_found",
            code: "cache_rule_not_found",
            message: `cache rule ${id} not found`,
          },
        },
        404,
      );
    }
    return c.json({ cache_rule: toCacheRuleDto(row) });
  },
);

secured.access(apiKeyPermission("gatewayCacheRules:create")).post(
  "/cache-rules",
  describeRoute({
    summary: "Create a cache rule",
    description:
      "Matchers are ANDed across non-null fields; at least one matcher is required. Mode is one of respect/force/disable. TTL is clamped to [0, 86400]. Salt is an optional cache-bust tag (max 64 chars). All writes emit a ChangeEvent so the gateway picks up the new rule within 30 s via its /changes long-poll.",
    tags: ["Cache Rules"],
    responses: {
      ...baseResponses,
      201: {
        description: "Created",
        content: {
          "application/json": {
            schema: resolver(z.object({ cache_rule: cacheRuleDtoSchema })),
          },
        },
      },
      400: {
        description: "Validation error",
        content: {
          "application/json": { schema: resolver(errorSchema) },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    const body = createCacheRuleSchema.safeParse(await c.req.json());
    if (!body.success) return validationErrorResponse(c, body.error);
    const organizationId = await orgIdForProject(project.id);
    const { actorUserId } = actorForRequest(c);
    const service = GatewayCacheRuleService.create(prisma);
    try {
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
      return c.json({ cache_rule: toCacheRuleDto(row) }, 201);
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
      ...baseResponses,
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
  async (c) => {
    const project = c.get("project");
    const id = c.req.param("id");
    const body = updateCacheRuleSchema.safeParse(await c.req.json());
    if (!body.success) return validationErrorResponse(c, body.error);
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
      "Soft-delete — sets archivedAt. The rule stops matching new requests. Audit log retains before/after snapshots. Returns the archived row.",
    tags: ["Cache Rules"],
    responses: {
      ...baseResponses,
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
    mode_enum: r.modeEnum,
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

function toBudgetDto(b: GatewayBudget, memberCount?: number) {
  return {
    id: b.id,
    organization_id: b.organizationId,
    scope_type: b.scopeType,
    scope_id: b.scopeId,
    name: b.name,
    description: b.description,
    window: b.window,
    on_breach: b.onBreach,
    limit_usd: b.limitUsd.toString(),
    spent_usd: b.spentUsd.toString(),
    timezone: b.timezone,
    provider_key: b.providerKey,
    current_period_started_at: b.currentPeriodStartedAt.toISOString(),
    resets_at: b.resetsAt.toISOString(),
    last_reset_at: b.lastResetAt?.toISOString() ?? null,
    archived_at: b.archivedAt?.toISOString() ?? null,
    created_at: b.createdAt.toISOString(),
    ...(memberCount !== undefined ? { member_count: memberCount } : {}),
  };
}

function scopeFromWire(
  scope: z.infer<typeof createBudgetSchema>["scope"],
): BudgetScope {
  switch (scope.kind) {
    case "ORGANIZATION":
      return { kind: "ORGANIZATION", organizationId: scope.organization_id };
    case "TEAM":
      return { kind: "TEAM", teamId: scope.team_id };
    case "PROJECT":
      return { kind: "PROJECT", projectId: scope.project_id };
    case "VIRTUAL_KEY":
      return { kind: "VIRTUAL_KEY", virtualKeyId: scope.virtual_key_id };
    case "PRINCIPAL":
      return { kind: "PRINCIPAL", principalUserId: scope.principal_user_id };
    case "GROUP":
      return { kind: "GROUP", groupId: scope.group_id };
    case "ATTRIBUTED_USER":
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
