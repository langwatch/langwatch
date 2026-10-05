import {
  apiErrorSchema,
  canonicalBaseResponses,
  canonicalConflictResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  RequestValidationError,
  resolver,
} from "@langwatch/api/rest";
import {
  type gatewayBudgetWireSchema,
  GatewayApi,
  toStoredEnum,
  toWireEnum,
  gatewayVirtualKeyDtoSchema,
  gatewayPlatformBudgetDtoSchema,
  gatewayPlatformCacheRuleDtoSchema,
  gatewaySpendSummaryDtoSchema,
  gatewayNextCursorSchema,
  gatewayPageQuerySchema,
  gatewayVirtualKeyListQuerySchema,
  gatewayBudgetListQuerySchema,
  gatewayResetBudgetQuerySchema,
  gatewayVkSpendWindowSchema,
  gatewayCreateVirtualKeySchema,
  gatewayUpdateVirtualKeySchema,
  gatewayCreateBudgetSchema,
  gatewayUpdateBudgetSchema,
  gatewayDisableVkSchema,
  gatewayResetBudgetSchema,
  gatewayCreateCacheRuleSchema,
  gatewayUpdateCacheRuleSchema,
  gatewayIdParamsSchema,
  gatewayRotateVirtualKeyBodySchema,
  gatewayEnableVirtualKeyBodySchema,
  gatewayRevokeVirtualKeyBodySchema,
  gatewayRetiredProviderBindingBodySchema,
  gatewayKeyCallerSchema,
  gatewayVirtualKeyCallerSchema,
  gatewayRequestCredentialSchema,
  GatewayProviderBindingsGoneError,
  type GatewayCacheRuleResource,
  type GatewayMintedVirtualKey,
  type GatewayVirtualKeySnakeDto,
  type GatewayVirtualKeyScope,
  type GatewayBudgetScope,
  type VirtualKeyBudgetInput,
} from "@langwatch/gateway-contract";
import { nowInstant, Temporal } from "@langwatch/time";
import { z } from "zod";

import * as budgetDtos from "../rules/gateway-budget-dto.rules.ts";
import { resolveVirtualKeySpendWindow } from "../rules/gateway-spend-window.rules.ts";
import {
  buildNextPageCursor,
  decodeCacheRuleCursor,
  decodeCreatedAtIdCursor,
} from "../rules/gateway-wire-pagination.rules.ts";

/**
 * The 410 the four retired provider-binding addresses publish. Spread per
 * route rather than folded into the canonical set, the way the 409 and 422
 * helpers are, so it stays a statement that this route really answers 410.
 */
const canonicalGoneResponses = {
  410: {
    description: "Gone. Gateway provider bindings folded into ModelProvider in iteration 110.",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
} as const;

/** The credential this request arrived on, as the project door resolved it. */
export const gatewayRestCredential = defineRestMiddleware(
  "gatewayRestCredential",
  gatewayRequestCredentialSchema,
);

/** The key an organization-owned route was called with, as the key door resolved it. */
export const gatewayKeyCaller = defineRestMiddleware("gatewayKeyCaller", gatewayKeyCallerSchema);

/** Who a virtual key route was called by, as the key door resolved it. */
export const gatewayVirtualKeyCaller = defineRestMiddleware(
  "gatewayVirtualKeyCaller",
  gatewayVirtualKeyCallerSchema,
);

/** With `reveal_once` the response withholds the secret and names the reveal instead. */
function createdVirtualKeyWire(
  virtualKey: GatewayVirtualKeySnakeDto,
  { secret, reveal }: GatewayMintedVirtualKey,
): {
  virtual_key: GatewayVirtualKeySnakeDto;
  secret?: string;
  reveal_id?: string;
  preview?: string;
} {
  if (reveal)
    return { virtual_key: virtualKey, reveal_id: reveal.revealId, preview: reveal.preview };
  return { virtual_key: virtualKey, secret };
}

/** A key defaults to its caller's project; a caller that names none must say its scopes. */
function scopesFromWire(
  scopes: z.infer<typeof gatewayCreateVirtualKeySchema>["scopes"] | undefined,
  fallbackProjectId: string | null,
): GatewayVirtualKeyScope[] {
  if (!scopes && fallbackProjectId === null) {
    throw new RequestValidationError({
      target: "json",
      violations: [
        {
          field: "scopes",
          type: "required",
          message:
            "Name the scopes the virtual key covers, or the project it belongs to in X-Project-Id.",
        },
      ],
    });
  }
  if (!scopes) return [{ scopeType: "PROJECT", scopeId: fallbackProjectId as string }];
  return scopes.map((s) => ({ scopeType: toStoredEnum(s.scope_type), scopeId: s.scope_id }));
}

function toCacheRuleDto(r: GatewayCacheRuleResource): {
  id: GatewayCacheRuleResource["id"];
  organization_id: GatewayCacheRuleResource["organizationId"];
  name: GatewayCacheRuleResource["name"];
  description: GatewayCacheRuleResource["description"];
  priority: GatewayCacheRuleResource["priority"];
  enabled: GatewayCacheRuleResource["enabled"];
  matchers: GatewayCacheRuleResource["matchers"];
  action: GatewayCacheRuleResource["action"];
  mode_enum: Lowercase<GatewayCacheRuleResource["mode"]>;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: r.id,
    organization_id: r.organizationId,
    name: r.name,
    description: r.description,
    priority: r.priority,
    enabled: r.enabled,
    matchers: r.matchers,
    action: r.action,
    mode_enum: toWireEnum(r.mode),
    archived_at: r.archivedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/**
 * The adapter's own return type is a plain `string` for `scope_reach`;
 * narrowed here to the two values it ever writes, matching the wire schema.
 */
const toBudgetDto = (
  ...args: Parameters<typeof budgetDtos.toBudgetDto>
): z.infer<typeof gatewayPlatformBudgetDtoSchema> =>
  budgetDtos.toBudgetDto(...args) as z.infer<typeof gatewayPlatformBudgetDtoSchema>;

/**
 * One budget with the spend the ledger holds for it now, the same figure the
 * listing reports. A write answers with this rather than the row it wrote,
 * whose stored spend column is not the live figure.
 */
async function liveBudgetAnswer({
  app,
  id,
  organizationId,
  includeReach = true,
}: {
  app: GatewayApi;
  id: string;
  organizationId: string;
  /** Reset answers with the row it just moved, not a fresh reach read (main's shape). */
  includeReach?: boolean;
}): Promise<{ budget: z.infer<typeof gatewayPlatformBudgetDtoSchema>; spend_available: boolean }> {
  const found = await app.getBudgetWithHealth({ id, organizationId });
  const memberCounts = await app.groupMemberCounts([found.budget]);
  return {
    spend_available: found.spendAvailable,
    budget: toBudgetDto({
      budget: found.budget,
      memberCount: memberCounts.get(found.budget.scopeId),
      ...(includeReach ? { reachable: !found.unreachableByAnyKey } : {}),
    }),
  };
}

function scopeFromWire(
  scope: z.infer<typeof gatewayCreateBudgetSchema>["scope"],
): GatewayBudgetScope {
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

/** Translates the snake budget wire onto the SAME schema tRPC's create validates with. */
function parseBudgetWire(
  app: GatewayApi,
  budget: z.infer<typeof gatewayBudgetWireSchema> | null | undefined,
): VirtualKeyBudgetInput | null | undefined {
  if (budget === undefined) return undefined;
  if (budget === null) return null;
  const parsed = app.parseVirtualKeyBudget({
    limitUsd: typeof budget.limit_usd === "number" ? String(budget.limit_usd) : budget.limit_usd,
    window: toStoredEnum(budget.window),
    onBreach: budget.on_breach && toStoredEnum(budget.on_breach),
    name: budget.name,
  });
  if (!parsed.success) {
    throw new RequestValidationError({
      target: "json",
      violations: [
        { field: "budget.limit_usd", type: "invalid_amount", message: parsed.error.message },
      ],
    });
  }
  return parsed.data;
}

export const gatewayPlatformRest = defineRestRouter(GatewayApi)
  .withNamespace("gateway")
  .withVersion(MANAGEMENT_API_VERSION)
  // The generation is the contract, not a dated namespace: the routes answer
  // exactly where they answer today, with no /api/v1 twin beside them.
  .withAddressing("v1-in-path", { generation: "v1" })

  // ── Virtual keys ─────────────────────────────────────────────────────────

  .get("/virtual-keys", "getApiGatewayV1VirtualKeys")
  .withCredential("api_key")
  .withQuery(gatewayVirtualKeyListQuerySchema)
  .withPermission("virtualKeys:view", { at: "grants" })
  .withOutput(
    z.object({ data: z.array(gatewayVirtualKeyDtoSchema), next_cursor: gatewayNextCursorSchema }),
  )
  .withDocs({
    summary: "List virtual keys",
    description:
      "Returns the virtual keys the caller can see. A credential that names a project (a project key, or an API key with X-Project-Id) sees the keys scoped to that project, to its team, or to the whole organization. An API key that names no project sees every key in its organization it holds virtualKeys:view on. Newest first, paged by cursor; a page can hold fewer rows than the limit before the walk is done.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const authorized = await app.getVirtualKeyCaller({ caller });
    const rows = await app.getVirtualKeyPage({
      organizationId: authorized.organizationId,
      limit: input.limit,
      cursor: input.cursor === undefined ? null : decodeCreatedAtIdCursor(input.cursor),
      externalId: input.external_id,
    });
    const visible = await app.visibleToVirtualKeyCaller({ caller: authorized, virtualKeys: rows });
    return {
      data: await app.toVirtualKeySnakeDtos({ virtualKeys: visible }),
      next_cursor: buildNextPageCursor(rows, input.limit, (vk) => [
        vk.createdAt.epochMilliseconds,
        vk.id,
      ]),
    };
  })

  .post("/virtual-keys", "postApiGatewayV1VirtualKeys")
  .withCredential("api_key")
  .withInput(gatewayCreateVirtualKeySchema)
  .withPermission("virtualKeys:create", { at: "grants" })
  .withStatus(201)
  .withOutput(
    z.object({
      virtual_key: gatewayVirtualKeyDtoSchema,
      secret: z.string().optional().describe("The secret, absent when `reveal_once` was set."),
      reveal_id: z
        .string()
        .optional()
        .describe("With `reveal_once`: the id that serves the secret once, through the app."),
      preview: z
        .string()
        .optional()
        .describe(
          "With `reveal_once`: the key's display prefix, safe to show in place of the secret.",
        ),
    }),
  )
  // The secret is minted once and stored only as a hash, so a caller losing
  // this response has no second way to read it - the whole reason this
  // route takes an idempotency key.
  .withIdempotency({ operation: "gateway.v1.virtual-keys.create" })
  .withDocs({
    summary: "Create virtual key",
    description:
      "Mints a new virtual key and returns the secret exactly once. With `reveal_once` the response withholds the secret and carries `reveal_id` and `preview` instead: the secret is parked for 24 hours and served once, to the person the key is for, through the LangWatch app. scopes defaults to the project the caller names; an API key that names no project must send scopes. Org- and team-scoped keys require virtualKeys:manage at each requested scope.",
    responses: { ...canonicalBaseResponses, ...canonicalConflictResponses },
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { actor, actorUserId, organizationId, projectId } = await app.getVirtualKeyCaller({
      caller,
    });
    const scopes = scopesFromWire(input.scopes, projectId);
    await app.authorizeVirtualKeyCreate({
      actor,
      organizationId,
      scopes,
      traceProjectId: input.trace_project_id,
      guardrailAttachments: input.config?.guardrailAttachments,
      callerProjectId: projectId ?? undefined,
    });
    const minted = await app.createVirtualKey({
      organizationId,
      name: input.name,
      description: input.description ?? null,
      principalUserId: input.principal_user_id ?? null,
      scopes,
      traceProjectId: input.trace_project_id ?? null,
      routingPolicyId: input.routing_policy_id ?? null,
      routingMode: input.routing_mode && toStoredEnum(input.routing_mode),
      expiresAt: input.expires_at ?? null,
      budget: parseBudgetWire(app, input.budget),
      config: input.config,
      externalId: input.external_id,
      metadata: input.metadata,
      actorUserId,
      revealOnce: input.reveal_once === true,
    });
    return createdVirtualKeyWire(await app.toVirtualKeySnakeDto(minted.virtualKey), minted);
  })

  .get("/virtual-keys/:id", "getApiGatewayV1VirtualKeysById")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withPermission("virtualKeys:view", { at: "grants" })
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({ summary: "Get virtual key", responses: canonicalBaseResponses })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const authorized = await app.getVirtualKeyCaller({ caller });
    const vk = await app.getVirtualKeyForCaller({
      caller: authorized,
      id: input.id,
      permission: "virtualKeys:view",
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(vk) };
  })

  .get("/virtual-keys/:id/spend", "getApiGatewayV1VirtualKeysByIdSpend")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withQuery(gatewayVkSpendWindowSchema)
  .withPermission("gatewayUsage:view", { at: "grants" })
  .withOutput(gatewaySpendSummaryDtoSchema)
  .withDocs({
    summary: "Read a virtual key's spend",
    description:
      "Aggregate spend and request count for one key over a window given in epoch milliseconds (default: current UTC calendar month). Returns 412 spend_source_unavailable on deploys without a ClickHouse spend source.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const authorized = await app.getVirtualKeyCaller({ caller });
    const { fromDate, toDate } = resolveVirtualKeySpendWindow({
      from: input.from,
      to: input.to,
      now: nowInstant(),
    });
    const vk = await app.getVirtualKeyForCaller({
      caller: authorized,
      id: input.id,
      permission: "gatewayUsage:view",
    });
    const spend = await app.getVirtualKeySpend({
      organizationId: authorized.organizationId,
      virtualKeyId: vk.id,
      window: { fromDate, toDate },
    });
    return {
      virtual_key_id: vk.id,
      spent_usd: spend.spentUsd,
      requests: spend.requests,
      window: { from: fromDate.epochMilliseconds, to: toDate.epochMilliseconds },
    };
  })

  .patch("/virtual-keys/:id", "patchApiGatewayV1VirtualKeysById")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayUpdateVirtualKeySchema)
  .withPermission("virtualKeys:update", { at: "grants" })
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Update virtual key",
    description: "Partial update: send only the fields you want to change.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { actor, actorUserId, organizationId, projectId } = await app.getVirtualKeyCaller({
      caller,
    });
    const scopes = input.scopes ? scopesFromWire(input.scopes, projectId) : undefined;
    await app.authorizeVirtualKeyUpdate({
      actor,
      organizationId,
      id: input.id,
      scopes,
      traceProjectId: input.trace_project_id,
      guardrailAttachments: input.config?.guardrailAttachments,
    });
    const updated = await app.updateVirtualKey({
      id: input.id,
      organizationId,
      actorUserId,
      name: input.name,
      description: input.description,
      scopes,
      traceProjectId: input.trace_project_id,
      routingPolicyId: input.routing_policy_id,
      routingMode: input.routing_mode && toStoredEnum(input.routing_mode),
      expiresAt: input.expires_at,
      budget: parseBudgetWire(app, input.budget),
      config: input.config,
      externalId: input.external_id,
      metadata: input.metadata,
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(updated) };
  })

  .post("/virtual-keys/:id/rotate", "postApiGatewayV1VirtualKeysByIdRotate")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayRotateVirtualKeyBodySchema)
  .withPermission("virtualKeys:rotate", { at: "grants" })
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema, secret: z.string() }))
  // Also mints a new secret, so a retried rotate must not mint twice.
  .withIdempotency({ operation: "gateway.v1.virtual-keys.rotate" })
  .withDocs({
    summary: "Rotate virtual key secret",
    description: "Mints a fresh secret for an existing VK. The old secret remains valid for 24h.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { actor, actorUserId, organizationId } = await app.getVirtualKeyCaller({ caller });
    await app.authorizeVirtualKeyOperation({
      actor,
      organizationId,
      id: input.id,
      permission: "virtualKeys:rotate",
    });
    const { virtualKey, secret } = await app.rotateVirtualKey({
      id: input.id,
      organizationId,
      actorUserId,
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(virtualKey), secret };
  })

  .post("/virtual-keys/:id/disable", "postApiGatewayV1VirtualKeysByIdDisable")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayDisableVkSchema)
  .withPermission("virtualKeys:update", { at: "grants" })
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Disable virtual key",
    description:
      "Reversible stop: requests on the key are rejected with virtual_key_disabled until it is enabled again. Idempotent.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { actor, actorUserId, organizationId } = await app.getVirtualKeyCaller({ caller });
    await app.authorizeVirtualKeyOperation({
      actor,
      organizationId,
      id: input.id,
      permission: "virtualKeys:update",
    });
    const updated = await app.disableVirtualKey({
      id: input.id,
      organizationId,
      actorUserId,
      reason: input.reason ?? null,
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(updated) };
  })

  .post("/virtual-keys/:id/enable", "postApiGatewayV1VirtualKeysByIdEnable")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayEnableVirtualKeyBodySchema)
  .withPermission("virtualKeys:update", { at: "grants" })
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Enable virtual key",
    description: "Reverses disable: the key returns to active exactly as it was. Idempotent.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { actor, actorUserId, organizationId } = await app.getVirtualKeyCaller({ caller });
    await app.authorizeVirtualKeyOperation({
      actor,
      organizationId,
      id: input.id,
      permission: "virtualKeys:update",
    });
    const updated = await app.enableVirtualKey({ id: input.id, organizationId, actorUserId });
    return { virtual_key: await app.toVirtualKeySnakeDto(updated) };
  })

  .post("/virtual-keys/:id/revoke", "postApiGatewayV1VirtualKeysByIdRevoke")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayRevokeVirtualKeyBodySchema)
  .withPermission("virtualKeys:delete", { at: "grants" })
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Revoke virtual key",
    description: "Marks the virtual key as revoked and archives its own budgets. Idempotent.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayVirtualKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { actor, actorUserId, organizationId } = await app.getVirtualKeyCaller({ caller });
    await app.authorizeVirtualKeyOperation({
      actor,
      organizationId,
      id: input.id,
      permission: "virtualKeys:delete",
    });
    const updated = await app.revokeVirtualKey({ id: input.id, organizationId, actorUserId });
    return { virtual_key: await app.toVirtualKeySnakeDto(updated) };
  })

  // ── Budgets ──────────────────────────────────────────────────────────────

  .get("/budgets", "getApiGatewayV1Budgets")
  .withCredential("api_key")
  .withQuery(gatewayBudgetListQuerySchema)
  .withPermission("gatewayBudgets:view")
  .withOutput(
    z.object({
      data: z.array(gatewayPlatformBudgetDtoSchema),
      spend_available: z.boolean(),
      next_cursor: gatewayNextCursorSchema,
    }),
  )
  .withDocs({
    summary: "List budgets",
    description:
      "Returns the non-archived budgets in the caller's organization across all seven scope types, with live spent_usd from the spend ledger. Takes a project key or an organization key; requires gatewayBudgets:view at the key's project, or at the organization for a key that names no project.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { organizationId } = await app.getKeyCaller({ caller });
    const { budgets, spendAvailable, scopeReach } = await app.listBudgetPageWithHealth({
      organizationId,
      limit: input.limit,
      cursor: input.cursor === undefined ? null : decodeCreatedAtIdCursor(input.cursor),
      scopeTypes: input.scope_type?.map((t) => toStoredEnum(t)),
      externalId: input.external_id,
    });
    const memberCounts = await app.groupMemberCounts(budgets);
    return {
      spend_available: spendAvailable,
      data: budgets.map((b) =>
        toBudgetDto({
          budget: b,
          memberCount: memberCounts.get(b.scopeId),
          reachable: scopeReach.get(b.id)?.reachable,
        }),
      ),
      next_cursor: buildNextPageCursor(budgets, input.limit, (b) => [
        b.createdAt.epochMilliseconds,
        b.id,
      ]),
    };
  })

  .get("/budgets/:id", "getApiGatewayV1BudgetsById")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayBudgets:view")
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema, spend_available: z.boolean() }))
  .withDocs({
    summary: "Get budget",
    description:
      "Takes a project key or an organization key; requires gatewayBudgets:view at the key's project, or at the organization for a key that names no project.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { organizationId } = await app.getKeyCaller({ caller });
    return liveBudgetAnswer({ app, id: input.id, organizationId });
  })

  .post("/budgets", "postApiGatewayV1Budgets")
  .withCredential("api_key")
  .withInput(gatewayCreateBudgetSchema)
  .withPermission("gatewayBudgets:create", { at: "organization" })
  .withStatus(201)
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withIdempotency({ operation: "gateway.v1.budgets.create" })
  .withDocs({
    summary: "Create budget",
    description:
      "Creates an organization-owned budget across all seven scope types. Spend is counted from the moment the budget is created, so spend earlier in the current window is not included. Requires gatewayBudgets:create at the organization; a project key or an organization key may call it.",
    responses: { ...canonicalBaseResponses, ...canonicalConflictResponses },
  })
  .withMiddleware(gatewayKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { organizationId, actorUserId } = await app.getKeyCaller({ caller });
    const row = await app.createBudget({
      organizationId,
      scope: scopeFromWire(input.scope),
      name: input.name,
      description: input.description ?? null,
      window: toStoredEnum(input.window),
      limitUsd: input.limit_usd,
      onBreach: input.on_breach && toStoredEnum(input.on_breach),
      timezone: input.timezone ?? null,
      providerKey: input.provider_key ?? null,
      externalId: input.external_id,
      metadata: input.metadata,
      cycleAnchorAt: input.cycle_anchor_at ? Temporal.Instant.from(input.cycle_anchor_at) : null,
      allowUnreachable: input.allow_unreachable,
      actorUserId,
    });
    const [memberCounts, reach] = await Promise.all([
      app.groupMemberCounts([row]),
      app.budgetScopeReach({ organizationId, scope: row }),
    ]);
    return {
      budget: toBudgetDto({
        budget: row,
        memberCount: memberCounts.get(row.scopeId),
        reachable: reach.reachable,
      }),
    };
  })

  .patch("/budgets/:id", "patchApiGatewayV1BudgetsById")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayUpdateBudgetSchema)
  .withPermission("gatewayBudgets:update", { at: "organization" })
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withDocs({
    summary: "Update budget",
    description:
      "Partial update. Scope, window and cycle_anchor_at are immutable after create. Answers with the budget's live spend, the same figure `GET /budgets` reports. Requires gatewayBudgets:update at the organization.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { organizationId, actorUserId } = await app.getKeyCaller({ caller });
    const row = await app.updateBudget({
      id: input.id,
      organizationId,
      name: input.name,
      description: input.description,
      limitUsd: input.limit_usd,
      onBreach: input.on_breach && toStoredEnum(input.on_breach),
      timezone: input.timezone,
      externalId: input.external_id,
      metadata: input.metadata,
      actorUserId,
    });
    const { budget } = await liveBudgetAnswer({ app, id: row.id, organizationId });
    return { budget };
  })

  .delete("/budgets/:id", "deleteApiGatewayV1BudgetsById")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayBudgets:delete", { at: "organization" })
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withDocs({
    summary: "Archive budget",
    description:
      "Soft-delete: the row is marked archived and no longer counted by the budget engine. Requires gatewayBudgets:delete at the organization.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { organizationId, actorUserId } = await app.getKeyCaller({ caller });
    const row = await app.archiveBudget({ id: input.id, organizationId, actorUserId });
    return { budget: toBudgetDto({ budget: row }) };
  })

  .post("/budgets/:id/reset", "postApiGatewayV1BudgetsByIdReset")
  .withCredential("api_key")
  .withParams(gatewayIdParamsSchema)
  .withQuery(gatewayResetBudgetQuerySchema)
  .withInput(gatewayResetBudgetSchema)
  .withPermission("gatewayBudgets:update", { at: "organization" })
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withDocs({
    summary: "Reset budget period",
    description:
      "Moves the budget's period boundary to now; recorded spend is never mutated. Requires gatewayBudgets:update at the organization.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayKeyCaller)
  .handle(async ({ app, input }, caller) => {
    const { organizationId, actorUserId } = await app.getKeyCaller({ caller });
    const row = await app.resetBudget({
      id: input.id,
      organizationId,
      actorUserId,
      endUserId: input.end_user_id ?? null,
      reason: input.reason ?? null,
    });
    const { budget } = await liveBudgetAnswer({
      app,
      id: row.id,
      organizationId,
      includeReach: false,
    });
    return { budget };
  })

  // ── Cache rules ──────────────────────────────────────────────────────────

  .get("/cache-rules", "getApiGatewayV1CacheRules")
  .withQuery(gatewayPageQuerySchema)
  .withPermission("gatewayCacheRules:view")
  .withOutput(
    z.object({
      data: z.array(gatewayPlatformCacheRuleDtoSchema),
      next_cursor: gatewayNextCursorSchema,
    }),
  )
  .withDocs({
    summary: "List cache-control rules",
    description:
      "Organization-scoped operator-authored rules, priority-ordered, archived rules excluded.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const rows = await app.listCacheRulePage({
      organizationId,
      limit: input.limit,
      cursor: input.cursor === undefined ? null : decodeCacheRuleCursor(input.cursor),
    });
    return {
      data: rows.map(toCacheRuleDto),
      next_cursor: buildNextPageCursor(rows, input.limit, (r) => [
        r.priority,
        r.createdAt.getTime(),
        r.id,
      ]),
    };
  })

  .get("/cache-rules/:id", "getApiGatewayV1CacheRulesById")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayCacheRules:view")
  .withOutput(z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }))
  .withDocs({
    summary: "Get a cache rule",
    description: "Returns the rule if it belongs to the caller's organisation; 404 otherwise.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const row = await app.getCacheRule({ id: input.id, organizationId });
    return { cache_rule: toCacheRuleDto(row) };
  })

  .post("/cache-rules", "postApiGatewayV1CacheRules")
  .withInput(gatewayCreateCacheRuleSchema)
  .withPermission("gatewayCacheRules:create")
  .withStatus(201)
  .withOutput(z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }))
  .withIdempotency({ operation: "gateway.v1.cache-rules.create" })
  .withDocs({
    summary: "Create a cache rule",
    description: "Matchers are ANDed across non-null fields; at least one matcher is required.",
    responses: { ...canonicalBaseResponses, ...canonicalConflictResponses },
  })
  .withMiddleware(gatewayRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const { actor, actorUserId } = app.actorForCredential({ projectId: scope.id, credential });
    const organizationId = await app.organizationIdForProject(scope.id);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayCacheRules:create",
    });
    const row = await app.createCacheRule({
      organizationId,
      name: input.name,
      description: input.description ?? null,
      priority: input.priority,
      enabled: input.enabled,
      matchers: input.matchers,
      action: input.action,
      actorUserId,
    });
    return { cache_rule: toCacheRuleDto(row) };
  })

  .patch("/cache-rules/:id", "patchApiGatewayV1CacheRulesById")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayUpdateCacheRuleSchema)
  .withPermission("gatewayCacheRules:update")
  .withOutput(z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }))
  .withDocs({
    summary: "Update a cache rule",
    description: "Partial update. matchers and action REPLACE the stored value when provided.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const { actor, actorUserId } = app.actorForCredential({ projectId: scope.id, credential });
    const organizationId = await app.organizationIdForProject(scope.id);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayCacheRules:update",
    });
    const row = await app.updateCacheRule({
      id: input.id,
      organizationId,
      name: input.name,
      description: input.description,
      priority: input.priority,
      enabled: input.enabled,
      matchers: input.matchers,
      action: input.action,
      actorUserId,
    });
    return { cache_rule: toCacheRuleDto(row) };
  })

  .delete("/cache-rules/:id", "deleteApiGatewayV1CacheRulesById")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayCacheRules:delete")
  .withOutput(z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }))
  .withDocs({
    summary: "Archive a cache rule",
    description: "Soft-delete: sets archivedAt. The rule stops matching new requests.",
    responses: canonicalBaseResponses,
  })
  .withMiddleware(gatewayRestCredential)
  .handle(async ({ app, input, scope }, credential) => {
    const { actor, actorUserId } = app.actorForCredential({ projectId: scope.id, credential });
    const organizationId = await app.organizationIdForProject(scope.id);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayCacheRules:delete",
    });
    const row = await app.archiveCacheRule({ id: input.id, organizationId, actorUserId });
    return { cache_rule: toCacheRuleDto(row) };
  })

  // ── Provider bindings, retired ───────────────────────────────────────────
  // Folded into ModelProvider in iteration 110. The addresses stay served
  // because a caller still on them needs to be told where the capability
  // went; dropping them answers 404 and says nothing.

  .get("/providers", "getApiGatewayV1Providers")
  .withPermission("gatewayProviders:view")
  .withOutput(z.void())
  .withDocs({
    summary: "List provider bindings",
    description:
      "Retired. Gateway provider bindings are model-provider rows now; list them at GET /api/gateway/v1/model-providers.",
    responses: { ...canonicalBaseResponses, ...canonicalGoneResponses },
  })
  .handle(() => {
    throw new GatewayProviderBindingsGoneError(
      "Use GET /api/gateway/v1/model-providers, or the Advanced (Gateway) tab in the dashboard.",
    );
  })

  .post("/providers", "postApiGatewayV1Providers")
  .withInput(gatewayRetiredProviderBindingBodySchema)
  .withPermission("gatewayProviders:manage")
  .withOutput(z.void())
  .withDocs({
    summary: "Bind a model provider to the gateway",
    description:
      "Retired. Rate limits, rotation and fallback priority are configured on the model provider itself.",
    responses: { ...canonicalBaseResponses, ...canonicalGoneResponses },
  })
  .handle(() => {
    throw new GatewayProviderBindingsGoneError(
      "Configure rate limits, provider configuration and fallback priority via the Advanced (Gateway) tab on /api/gateway/v1/model-providers.",
    );
  })

  .patch("/providers/:id", "patchApiGatewayV1ProvidersById")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayRetiredProviderBindingBodySchema)
  .withPermission("gatewayProviders:update")
  .withOutput(z.void())
  .withDocs({
    summary: "Update provider binding",
    description: "Retired. The advanced gateway fields are patched on the model provider itself.",
    responses: { ...canonicalBaseResponses, ...canonicalGoneResponses },
  })
  .handle(() => {
    throw new GatewayProviderBindingsGoneError(
      "Patch the advanced fields via PATCH /api/gateway/v1/model-providers/:id.",
    );
  })

  .delete("/providers/:id", "deleteApiGatewayV1ProvidersById")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayProviders:manage")
  .withOutput(z.void())
  .withDocs({
    summary: "Disable provider binding",
    description: "Retired. Disabling the underlying model provider is the replacement.",
    responses: { ...canonicalBaseResponses, ...canonicalGoneResponses },
  })
  .handle(() => {
    throw new GatewayProviderBindingsGoneError(
      "Disable the underlying model provider via DELETE /api/gateway/v1/model-providers/:id.",
    );
  })

  .build();
