/**
 * The public `/api/gateway/v1` surface: virtual-key CRUD, budgets and
 * cache-control rules, behind a project-scoped API key. Every write reaches
 * an organization-owned row, so authorization is resolved per scope by the
 * application (GatewayApp), never by this transport.
 */
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import {
  GatewayApi,
  GatewayWindow,
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
  gatewayBudgetScopeTypeSchema,
  gatewayResetBudgetQuerySchema,
  gatewayVkSpendWindowSchema,
  gatewayCreateVirtualKeySchema,
  gatewayUpdateVirtualKeySchema,
  gatewayBudgetWireSchema,
  gatewayCreateBudgetSchema,
  gatewayUpdateBudgetSchema,
  gatewayDisableVkSchema,
  gatewayResetBudgetSchema,
  gatewayCreateCacheRuleSchema,
  gatewayUpdateCacheRuleSchema,
  gatewayIdParamsSchema,
  type GatewayCaller,
  type GatewayCacheRuleResource,
  type GatewayVirtualKeyScope,
  type GatewayBudgetScope,
  type VirtualKeyBudgetInput,
} from "@langwatch/gateway-contract";
import {
  canonicalBaseResponses,
  canonicalConflictResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { z } from "zod";

import { GatewayWirePaginationAdapter } from "../adapters/gateway-wire-pagination.adapter.ts";
import { GatewayBudgetDtoAdapter } from "../adapters/gateway-budget-dto.adapter.ts";

const wirePages = GatewayWirePaginationAdapter.create();
const budgetDtos = GatewayBudgetDtoAdapter.create();
const MAX_EPOCH_MS = 8_640_000_000_000_000;

/** The stable actor id every write records, from the door's resolved caller. */
function actorUserIdOf(actor: GatewayCaller): string {
  const caller = actor as { type?: string; id?: string } | null;
  if (caller && (caller.type === "user" || caller.type === "api_key") && caller.id) {
    return caller.id;
  }
  throw new Error("gateway platform route resolved no actor id");
}

function cursorInstant(part: unknown): Instant | null {
  const epochMs = Number(part);
  if (!Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_EPOCH_MS) return null;
  return Temporal.Instant.fromEpochMilliseconds(epochMs);
}

function createdAtIdCursor(
  encoded: string | undefined,
): { createdAt: Instant; id: string } | null | undefined {
  if (encoded === undefined) return undefined;
  const parts = wirePages.decodePageCursor(encoded, 2);
  if (!parts) return null;
  const createdAt = cursorInstant(parts[0]);
  return createdAt ? { createdAt, id: String(parts[1]) } : null;
}

function scopesFromWire(
  scopes: z.infer<typeof gatewayCreateVirtualKeySchema>["scopes"] | undefined,
  fallbackProjectId: string,
): GatewayVirtualKeyScope[] {
  if (!scopes) return [{ scopeType: "PROJECT", scopeId: fallbackProjectId }];
  return scopes.map((s) => ({ scopeType: toStoredEnum(s.scope_type), scopeId: s.scope_id }));
}

function toCacheRuleDto(r: GatewayCacheRuleResource) {
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

/** The adapter's own return type is a plain `string` for `scope_reach`; narrowed here to the two values it ever writes, matching the wire schema. */
const toBudgetDto = (
  ...args: Parameters<typeof budgetDtos.toBudgetDto>
): z.infer<typeof gatewayPlatformBudgetDtoSchema> =>
  budgetDtos.toBudgetDto(...args) as z.infer<typeof gatewayPlatformBudgetDtoSchema>;

function scopeFromWire(scope: z.infer<typeof gatewayCreateBudgetSchema>["scope"]): GatewayBudgetScope {
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
function budgetFromWire(
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
  if (!parsed.success) throw new Error(`validation_error: ${parsed.error.message}`);
  return parsed.data;
}

export const gatewayPlatformRest = defineRestRouter(GatewayApi)
  .withNamespace("gateway")
  .withVersion(MANAGEMENT_API_VERSION)
  // The generation is the contract, not a dated namespace: the routes answer
  // exactly where they answer today, with no /api/v1 twin beside them.
  .withAddressing("v1-in-path", { generation: "v1" })

  // ── Virtual keys ─────────────────────────────────────────────────────────

  .get("/virtual-keys", "listVirtualKeys")
  .withQuery(gatewayVirtualKeyListQuerySchema)
  .withPermission("virtualKeys:view")
  .withOutput(z.object({ data: z.array(gatewayVirtualKeyDtoSchema), next_cursor: gatewayNextCursorSchema }))
  .withDocs({
    summary: "List virtual keys",
    description:
      "Returns the virtual keys visible to the caller's project credential: keys scoped to this project, to its team, or to the whole organization. Newest first, paged by cursor.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const cursor = createdAtIdCursor(input.cursor);
    if (cursor === null) throw new Error("invalid_cursor");
    const rows = await app.getVirtualKeyPage({
      organizationId,
      limit: input.limit,
      cursor: cursor ?? null,
      externalId: input.external_id,
    });
    const visible = app.visibleToProjectCredential({ project: { id: scope.id }, virtualKeys: rows });
    return {
      data: await app.toVirtualKeySnakeDtos({ virtualKeys: visible }),
      next_cursor: wirePages.nextPageCursor(rows, input.limit, (vk) => [
        vk.createdAt.epochMilliseconds,
        vk.id,
      ]),
    };
  })

  .post("/virtual-keys", "createVirtualKey")
  .withInput(gatewayCreateVirtualKeySchema)
  .withPermission("virtualKeys:create")
  .withStatus(201)
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema, secret: z.string() }))
  // The secret is minted once and stored only as a hash, so a caller losing
  // this response has no second way to read it - the whole reason this
  // route takes an idempotency key.
  .withIdempotency({ operation: "gateway.v1.virtual-keys.create" })
  .withDocs({
    summary: "Create virtual key",
    description:
      "Mints a new virtual key and returns the secret exactly once. scopes defaults to the caller's project; org- and team-scoped keys require virtualKeys:manage at each requested scope.",
    responses: { ...canonicalBaseResponses, ...canonicalConflictResponses },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    const scopes = scopesFromWire(input.scopes, scope.id);
    await app.authorizeVirtualKeyCreate({
      actor,
      organizationId,
      scopes,
      traceProjectId: input.trace_project_id,
      guardrailAttachments: input.config?.guardrailAttachments,
    });
    const { virtualKey, secret } = await app.createVirtualKey({
      organizationId,
      name: input.name,
      description: input.description ?? null,
      principalUserId: input.principal_user_id ?? null,
      scopes,
      traceProjectId: input.trace_project_id ?? null,
      routingPolicyId: input.routing_policy_id ?? null,
      routingMode: input.routing_mode && toStoredEnum(input.routing_mode),
      expiresAt: input.expires_at ? Temporal.Instant.fromEpochMilliseconds(input.expires_at.getTime()) : null,
      budget: budgetFromWire(app, input.budget),
      config: input.config,
      externalId: input.external_id,
      metadata: input.metadata,
      actorUserId,
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(virtualKey), secret };
  })

  .get("/virtual-keys/:id", "getVirtualKey")
  .withParams(gatewayIdParamsSchema)
  .withPermission("virtualKeys:view")
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({ summary: "Get virtual key", responses: canonicalBaseResponses })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const vk = await app.requireVisibleVirtualKeyForProjectCredential({
      project: { id: scope.id },
      id: input.id,
      organizationId,
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(vk) };
  })

  .get("/virtual-keys/:id/spend", "getVirtualKeySpend")
  .withParams(gatewayIdParamsSchema)
  .withQuery(gatewayVkSpendWindowSchema)
  .withPermission("gatewayUsage:view")
  .withOutput(gatewaySpendSummaryDtoSchema)
  .withDocs({
    summary: "Read a virtual key's spend",
    description:
      "Aggregate spend and request count for one key over a window given in epoch milliseconds (default: current UTC calendar month). Returns 412 spend_source_unavailable on deploys without a ClickHouse spend source.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const now = nowInstant();
    const fromDate =
      input.from !== undefined ? Temporal.Instant.fromEpochMilliseconds(input.from) : GatewayWindow.startOfCurrentMonthUTC(now);
    const toDate = input.to !== undefined ? Temporal.Instant.fromEpochMilliseconds(input.to) : now;
    if (fromDate.epochMilliseconds >= toDate.epochMilliseconds) {
      throw new Error("`from` must be before `to`");
    }
    const vk = await app.requireVisibleVirtualKeyForProjectCredential({
      project: { id: scope.id },
      id: input.id,
      organizationId,
    });
    if (!app.isSpendSourceAvailable()) {
      throw new Error("spend_source_unavailable");
    }
    const spend = await app.spendByVirtualKey({
      organizationId,
      virtualKeyIds: [vk.id],
      window: { fromDate, toDate },
    });
    const row = spend.get(vk.id);
    return {
      virtual_key_id: vk.id,
      spent_usd: row?.spentUsd ?? "0",
      requests: row?.requests ?? 0,
      window: { from: fromDate.epochMilliseconds, to: toDate.epochMilliseconds },
    };
  })

  .patch("/virtual-keys/:id", "updateVirtualKey")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayUpdateVirtualKeySchema)
  .withPermission("virtualKeys:update")
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Update virtual key",
    description: "Partial update: send only the fields you want to change.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const scopes = input.scopes ? scopesFromWire(input.scopes, scope.id) : undefined;
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
      actorUserId: actorUserIdOf(actor),
      name: input.name,
      description: input.description,
      scopes,
      traceProjectId: input.trace_project_id,
      routingPolicyId: input.routing_policy_id,
      routingMode: input.routing_mode && toStoredEnum(input.routing_mode),
      expiresAt:
        input.expires_at === undefined
          ? undefined
          : input.expires_at === null
            ? null
            : Temporal.Instant.fromEpochMilliseconds(input.expires_at.getTime()),
      budget: budgetFromWire(app, input.budget),
      config: input.config,
      externalId: input.external_id,
      metadata: input.metadata,
    });
    return { virtual_key: await app.toVirtualKeySnakeDto(updated) };
  })

  .post("/virtual-keys/:id/rotate", "rotateVirtualKey")
  .withParams(gatewayIdParamsSchema)
  .withPermission("virtualKeys:rotate")
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema, secret: z.string() }))
  // Also mints a new secret, so a retried rotate must not mint twice.
  .withIdempotency({ operation: "gateway.v1.virtual-keys.rotate" })
  .withDocs({
    summary: "Rotate virtual key secret",
    description: "Mints a fresh secret for an existing VK. The old secret remains valid for 24h.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
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

  .post("/virtual-keys/:id/disable", "disableVirtualKey")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayDisableVkSchema)
  .withPermission("virtualKeys:update")
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Disable virtual key",
    description:
      "Reversible stop: requests on the key are rejected with virtual_key_disabled until it is enabled again. Idempotent.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
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

  .post("/virtual-keys/:id/enable", "enableVirtualKey")
  .withParams(gatewayIdParamsSchema)
  .withPermission("virtualKeys:update")
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Enable virtual key",
    description: "Reverses disable: the key returns to active exactly as it was. Idempotent.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    await app.authorizeVirtualKeyOperation({
      actor,
      organizationId,
      id: input.id,
      permission: "virtualKeys:update",
    });
    const updated = await app.enableVirtualKey({ id: input.id, organizationId, actorUserId });
    return { virtual_key: await app.toVirtualKeySnakeDto(updated) };
  })

  .post("/virtual-keys/:id/revoke", "revokeVirtualKey")
  .withParams(gatewayIdParamsSchema)
  .withPermission("virtualKeys:delete")
  .withOutput(z.object({ virtual_key: gatewayVirtualKeyDtoSchema }))
  .withDocs({
    summary: "Revoke virtual key",
    description:
      "Marks the virtual key as revoked and archives its own budgets. Idempotent.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
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

  .get("/budgets", "listBudgets")
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
      "Returns the non-archived budgets in the caller's organization across all seven scope types, with live spent_usd from the spend ledger.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const cursor = createdAtIdCursor(input.cursor);
    if (cursor === null) throw new Error("invalid_cursor");
    const scopeTypes =
      input.scope_type !== undefined
        ? gatewayBudgetScopeTypeSchema.array().min(1).parse(input.scope_type.split(",").map((s) => s.trim()))
        : undefined;
    const { budgets, spendAvailable } = await app.listBudgetPageWithHealth({
      organizationId,
      limit: input.limit,
      cursor: cursor ?? null,
      scopeTypes: scopeTypes?.map((t) => toStoredEnum(t)),
      externalId: input.external_id,
    });
    const memberCounts = await app.groupMemberCounts(budgets);
    return {
      spend_available: spendAvailable,
      data: budgets.map((b) => toBudgetDto({ budget: b, memberCount: memberCounts.get(b.scopeId) })),
      next_cursor: wirePages.nextPageCursor(budgets, input.limit, (b) => [
        b.createdAt.epochMilliseconds,
        b.id,
      ]),
    };
  })

  .get("/budgets/:id", "getBudget")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayBudgets:view")
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema, spend_available: z.boolean() }))
  .withDocs({ summary: "Get budget", responses: canonicalBaseResponses })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const found = await app.tryGetBudgetWithHealth({ id: input.id, organizationId });
    if (!found) throw new Error(`budget ${input.id} not found`);
    const memberCounts = await app.groupMemberCounts([found.budget]);
    return {
      spend_available: found.spendAvailable,
      budget: toBudgetDto({
        budget: found.budget,
        memberCount: memberCounts.get(found.budget.scopeId),
        reachable: !found.unreachableByAnyKey,
      }),
    };
  })

  .post("/budgets", "createBudget")
  .withInput(gatewayCreateBudgetSchema)
  .withPermission("gatewayBudgets:create")
  .withStatus(201)
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withIdempotency({ operation: "gateway.v1.budgets.create" })
  .withDocs({
    summary: "Create budget",
    description: "Creates an organization-owned budget across all seven scope types.",
    responses: { ...canonicalBaseResponses, ...canonicalConflictResponses },
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayBudgets:create",
    });
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
      budget: toBudgetDto({ budget: row, memberCount: memberCounts.get(row.scopeId), reachable: reach.reachable }),
    };
  })

  .patch("/budgets/:id", "updateBudget")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayUpdateBudgetSchema)
  .withPermission("gatewayBudgets:update")
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withDocs({
    summary: "Update budget",
    description: "Partial update. Scope, window and cycle_anchor_at are immutable after create.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayBudgets:update",
    });
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
    const memberCounts = await app.groupMemberCounts([row]);
    return { budget: toBudgetDto({ budget: row, memberCount: memberCounts.get(row.scopeId) }) };
  })

  .delete("/budgets/:id", "archiveBudget")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayBudgets:delete")
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withDocs({
    summary: "Archive budget",
    description: "Soft-delete: the row is marked archived and no longer counted by the budget engine.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayBudgets:delete",
    });
    const row = await app.archiveBudget({ id: input.id, organizationId, actorUserId });
    return { budget: toBudgetDto({ budget: row }) };
  })

  .post("/budgets/:id/reset", "resetBudget")
  .withParams(gatewayIdParamsSchema)
  .withQuery(gatewayResetBudgetQuerySchema)
  .withInput(gatewayResetBudgetSchema)
  .withPermission("gatewayBudgets:update")
  .withOutput(z.object({ budget: gatewayPlatformBudgetDtoSchema }))
  .withDocs({
    summary: "Reset budget period",
    description: "Moves the budget's period boundary to now; recorded spend is never mutated.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayBudgets:update",
    });
    const row = await app.resetBudget({
      id: input.id,
      organizationId,
      actorUserId,
      endUserId: input.end_user_id ?? null,
      reason: input.reason ?? null,
    });
    const memberCounts = await app.groupMemberCounts([row]);
    return { budget: toBudgetDto({ budget: row, memberCount: memberCounts.get(row.scopeId) }) };
  })

  // ── Cache rules ──────────────────────────────────────────────────────────

  .get("/cache-rules", "listCacheRules")
  .withQuery(gatewayPageQuerySchema)
  .withPermission("gatewayCacheRules:view")
  .withOutput(z.object({ data: z.array(gatewayPlatformCacheRuleDtoSchema), next_cursor: gatewayNextCursorSchema }))
  .withDocs({
    summary: "List cache-control rules",
    description: "Organization-scoped operator-authored rules, priority-ordered, archived rules excluded.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const parts = input.cursor !== undefined ? wirePages.decodePageCursor(input.cursor, 3) : undefined;
    if (input.cursor !== undefined && !parts) throw new Error("invalid_cursor");
    const priority = parts ? Number(parts[0]) : undefined;
    const createdAt = parts ? cursorInstant(parts[1]) : undefined;
    if (parts && (priority === undefined || Number.isNaN(priority) || !createdAt)) {
      throw new Error("invalid_cursor");
    }
    const cursor =
      parts && createdAt ? { priority: priority as number, createdAt, id: String(parts[2]) } : null;
    const rows = await app.listCacheRulePage({ organizationId, limit: input.limit, cursor });
    return {
      data: rows.map(toCacheRuleDto),
      next_cursor: wirePages.nextPageCursor(rows, input.limit, (r) => [
        r.priority,
        r.createdAt.getTime(),
        r.id,
      ]),
    };
  })

  .get("/cache-rules/:id", "getCacheRule")
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
    const row = await app.findCacheRule({ id: input.id, organizationId });
    if (!row) throw new Error(`cache rule ${input.id} not found`);
    return { cache_rule: toCacheRuleDto(row) };
  })

  .post("/cache-rules", "createCacheRule")
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
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
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

  .patch("/cache-rules/:id", "updateCacheRule")
  .withParams(gatewayIdParamsSchema)
  .withInput(gatewayUpdateCacheRuleSchema)
  .withPermission("gatewayCacheRules:update")
  .withOutput(z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }))
  .withDocs({
    summary: "Update a cache rule",
    description: "Partial update. matchers and action REPLACE the stored value when provided.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
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

  .delete("/cache-rules/:id", "archiveCacheRule")
  .withParams(gatewayIdParamsSchema)
  .withPermission("gatewayCacheRules:delete")
  .withOutput(z.object({ cache_rule: gatewayPlatformCacheRuleDtoSchema }))
  .withDocs({
    summary: "Archive a cache rule",
    description: "Soft-delete: sets archivedAt. The rule stops matching new requests.",
    responses: canonicalBaseResponses,
  })
  .handle(async ({ app, input, scope, actor }) => {
    const organizationId = await app.organizationIdForProject(scope.id);
    const actorUserId = actorUserIdOf(actor);
    await app.authorizeOrganizationWideOperation({
      actor,
      organizationId,
      permission: "gatewayCacheRules:delete",
    });
    const row = await app.archiveCacheRule({ id: input.id, organizationId, actorUserId });
    return { cache_rule: toCacheRuleDto(row) };
  })

  .build();
