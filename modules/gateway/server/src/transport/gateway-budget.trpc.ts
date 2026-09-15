/**
 * The server half of `gatewayBudgets.*`. Normalising a screen's (scope kind,
 * target id) onto scopeType plus the typed column is the application's job,
 * not this transport's, which parses input and delegates.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  GatewayApi,
  gatewayBudgetTrpc,
  scopeTargetKey,
  effectiveBudgetPeriod,
  type GatewayBudgetWithSeats,
} from "@langwatch/gateway-contract";
import { toDate } from "@langwatch/time";
import { TRPCError } from "@trpc/server";

import { GatewayProviderLabelAdapter } from "../adapters/gateway-provider-label.adapter.ts";

/** One stateless label resolver for every budget row this door renders. */
const providerLabelAdapter = GatewayProviderLabelAdapter.create();

function toDto(b: GatewayBudgetWithSeats) {
  // Computed, not read off the row: the stored columns only move at create
  // and at an explicit reset, so a budget past its first boundary would
  // otherwise report a period that closed months ago next to this period's
  // spend. See effectiveBudgetPeriod.
  const period = effectiveBudgetPeriod(b);

  return {
    id: b.id,
    organizationId: b.organizationId,
    scopeType: b.scopeType,
    scopeId: b.scopeId,
    name: b.name,
    description: b.description,
    window: b.window,
    onBreach: b.onBreach,
    limitUsd: b.limitUsd.toString(),
    spentUsd: b.spentUsd.toString(),
    timezone: b.timezone,
    providerKey: b.providerKey,
    currentPeriodStartedAt: toDate(period.currentPeriodStartedAt).toISOString(),
    resetsAt: toDate(period.resetsAt).toISOString(),
    /** Null is calendar alignment; set, it is the phase the window cycles on. */
    cycleAnchorAt: b.cycleAnchorAt ? toDate(b.cycleAnchorAt).toISOString() : null,
    lastResetAt: b.lastResetAt ? toDate(b.lastResetAt).toISOString() : null,
    archivedAt: b.archivedAt ? toDate(b.archivedAt).toISOString() : null,
    createdAt: toDate(b.createdAt).toISOString(),
    // Per-person templates only: how many end users the template saw this
    // period and how many are over their own cap.
    endUsersSeen: b.endUsersSeen ?? null,
    endUsersOver: b.endUsersOver ?? null,
  };
}

export const gatewayBudgetTrpcTransport = defineTrpcRouter(GatewayApi, gatewayBudgetTrpc)
  .procedure("list")
  .withPermission("gatewayBudgets:view")
  .handle(async ({ app, input }) => {
    await app.assertOrganizationExists(input.organizationId);
    const { budgets, spendAvailable, scopeReach } = await app.listBudgetsWithHealth(
      input.organizationId,
    );
    const scopeTargets = await app.listBudgetScopeTargets(budgets, input.organizationId);
    const providerLabels = await app.resolveProviderLabels(budgets);

    return {
      spendAvailable,
      budgets: budgets.map((b) => ({
        ...toDto(b),
        spendAvailable,
        unreachableByAnyKey: scopeReach.get(b.id)?.reachable === false,
        scopeTarget: scopeTargets.get(scopeTargetKey(b.scopeType, b.scopeId)) ?? null,
        providerLabel: providerLabelAdapter.labelFor(providerLabels, b.providerKey),
      })),
    };
  })

  .procedure("listForProject")
  .withPermission("gatewayBudgets:view")
  .handle(async ({ app, input }) => {
    const { budgets, spendAvailable, scopeReach } = await app.listProjectBudgetsWithHealth(
      input.projectId,
    );
    // The organization the project belongs to, so VIRTUAL_KEY / GROUP /
    // PRINCIPAL targets resolve inside the right tenant.
    const organizationId = await app.findProjectOrganization(input.projectId);
    const scopeTargets = await app.listBudgetScopeTargets(budgets, organizationId ?? null);
    const providerLabels = await app.resolveProviderLabels(budgets);

    return {
      spendAvailable,
      budgets: budgets.map((b) => ({
        ...toDto(b),
        spendAvailable,
        unreachableByAnyKey: scopeReach.get(b.id)?.reachable === false,
        scopeTarget: scopeTargets.get(scopeTargetKey(b.scopeType, b.scopeId)) ?? null,
        providerLabel: providerLabelAdapter.labelFor(providerLabels, b.providerKey),
      })),
    };
  })

  .procedure("get")
  .withPermission("gatewayBudgets:view")
  .handle(async ({ app, input }) => {
    await app.assertOrganizationExists(input.organizationId);
    const detail = await app.findBudgetDetail({ id: input.id, organizationId: input.organizationId });
    if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "budget not found" });

    const providerLabels = await app.resolveProviderLabels([detail.budget]);

    return {
      ...toDto(detail.budget),
      spendAvailable: detail.spendAvailable,
      unreachableByAnyKey: detail.unreachableByAnyKey,
      scopeTarget: detail.scopeTarget,
      providerLabel: providerLabelAdapter.labelFor(providerLabels, detail.budget.providerKey),
      recentLedger: detail.recentLedger.map((l) => ({
        id: l.id,
        virtualKeyId: l.virtualKeyId,
        virtualKeyName: l.virtualKey?.name ?? l.virtualKeyId,
        virtualKeyPrefix: l.virtualKey?.displayPrefix ?? "",
        amountUsd: l.amountUsd.toString(),
        model: l.model,
        status: l.status,
        occurredAt: toDate(l.occurredAt).toISOString(),
      })),
    };
  })

  // group.listAll demands organization:manage; a creator only needs names and
  // sizes, so this stays gated by the same permission as the create it serves.
  .procedure("groupTargets")
  .withPermission("gatewayBudgets:create")
  .handle(async ({ app, input }) => [...(await app.listGroupTargets(input.organizationId))])

  .procedure("create")
  .withPermission("gatewayBudgets:create")
  .handle(async ({ app, input, actor }) => {
    const row = await app.createBudget({
      organizationId: input.organizationId,
      scope: input.scope,
      name: input.name,
      description: input.description ?? null,
      window: input.window,
      limitUsd: input.limitUsd,
      onBreach: input.onBreach,
      timezone: input.timezone ?? null,
      providerKey: input.providerKey ?? null,
      cycleAnchorAt: input.cycleAnchorAt ?? null,
      allowUnreachable: input.allowUnreachable,
      actorUserId: actor.id,
    });

    return toDto(row);
  })

  .procedure("update")
  .withPermission("gatewayBudgets:update")
  .handle(async ({ app, input, actor }) => {
    const row = await app.updateBudget({ ...input, actorUserId: actor.id });

    return toDto(row);
  })

  .procedure("archive")
  .withPermission("gatewayBudgets:delete")
  .handle(async ({ app, input, actor }) => {
    const row = await app.archiveBudget({ ...input, actorUserId: actor.id });

    return toDto(row);
  })

  .procedure("reset")
  .withPermission("gatewayBudgets:update")
  .handle(async ({ app, input, actor }) => {
    const row = await app.resetBudget({
      id: input.id,
      organizationId: input.organizationId,
      actorUserId: actor.id,
      endUserId: input.endUserId ?? null,
      reason: input.reason ?? null,
    });

    return toDto(row);
  })
  .build();
