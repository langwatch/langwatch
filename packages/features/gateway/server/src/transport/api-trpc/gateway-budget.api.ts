/**
 * Gateway budget administration over tRPC. Normalising a screen's (scope kind, target id) onto
 * scopeType + the typed column is the service's job, not this transport's, which only parses
 * input and delegates to the one budget-decision service.
 */
import { toDate } from "@langwatch/time";
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  gatewayBudgetApiBudgetInputSchema,
  gatewayBudgetApiCreateInputSchema,
  gatewayBudgetApiOrganizationInputSchema,
  gatewayBudgetApiProjectInputSchema,
  gatewayBudgetApiResetInputSchema,
  gatewayBudgetApiUpdateInputSchema,
  gatewayBudgetDetailSchema,
  gatewayBudgetDtoResponseSchema,
  gatewayBudgetGroupTargetsSchema,
  gatewayBudgetListSchema,
  scopeTargetKey,
  type GatewayBudgetWithSeats,
  effectiveBudgetPeriod,
} from "@langwatch/gateway-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { GatewayProviderLabelAdapter } from "../../adapters/gateway-provider-label.adapter.ts";
import type { GatewayApp } from "#app/gateway.app";

/** One stateless label resolver for every budget row this door renders. */
const providerLabelAdapter = GatewayProviderLabelAdapter.create();

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayBudgetTrpcContext = Readonly<{
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
}>;

/** Applied after `.input()`, not ahead of it: every declaration reads its scope id from it. */
type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type GatewayBudgetTrpcProcedures<
  TContext extends GatewayBudgetTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** Tracing, logging, error shaping, scope lineage, the check, and audit. */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

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

/** Installs the complete `gatewayBudgets.*` tRPC surface on a process root. */
export class GatewayBudgetTrpcApi {
  static create<
    TContext extends GatewayBudgetTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayBudgetTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput,
      })
        .query("list", (p) =>
          p
            .withInput(gatewayBudgetApiOrganizationInputSchema)
            .withOutput(gatewayBudgetListSchema)
            .withPermission("gatewayBudgets:view")
            .handle(async ({ ctx, input }) => {
              await ctx.app.gateway.assertOrganizationExists(input.organizationId);
              const { budgets, spendAvailable, scopeReach } =
                await ctx.app.gateway.listBudgetsWithHealth(input.organizationId);
              const scopeTargets = await ctx.app.gateway.listBudgetScopeTargets(
                budgets,
                input.organizationId,
              );
              const providerLabels = await ctx.app.gateway.resolveProviderLabels(budgets);
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
            }),
        )
        .query("listForProject", (p) =>
          p
            .withInput(gatewayBudgetApiProjectInputSchema)
            .withOutput(gatewayBudgetListSchema)
            .withPermission("gatewayBudgets:view")
            .handle(async ({ ctx, input }) => {
              const { budgets, spendAvailable, scopeReach } =
                await ctx.app.gateway.listProjectBudgetsWithHealth(input.projectId);
              // The organization the project belongs to, so VIRTUAL_KEY / GROUP /
              // PRINCIPAL targets resolve inside the right tenant. Read through the
              // Project service rather than a Prisma client, which this transport
              // does not hold.
              const organizationId = await ctx.app.gateway.tryGetProjectOrganization(
                input.projectId,
              );
              const scopeTargets = await ctx.app.gateway.listBudgetScopeTargets(
                budgets,
                organizationId ?? null,
              );
              const providerLabels = await ctx.app.gateway.resolveProviderLabels(budgets);
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
            }),
        )
        .query("get", (p) =>
          p
            .withInput(gatewayBudgetApiBudgetInputSchema)
            .withOutput(gatewayBudgetDetailSchema)
            .withPermission("gatewayBudgets:view")
            .handle(async ({ ctx, input }) => {
              await ctx.app.gateway.assertOrganizationExists(input.organizationId);
              const detail = await ctx.app.gateway.tryGetBudgetDetail({
                id: input.id,
                organizationId: input.organizationId,
              });
              if (!detail) {
                throw new TRPCError({ code: "NOT_FOUND", message: "budget not found" });
              }
              const providerLabels = await ctx.app.gateway.resolveProviderLabels([detail.budget]);
              return {
                ...toDto(detail.budget),
                spendAvailable: detail.spendAvailable,
                unreachableByAnyKey: detail.unreachableByAnyKey,
                scopeTarget: detail.scopeTarget,
                providerLabel: providerLabelAdapter.labelFor(
                  providerLabels,
                  detail.budget.providerKey,
                ),
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
            }),
        )
        // group.listAll demands organization:manage; a creator only needs names and sizes,
        // so this stays gated by the same permission as the create it serves.
        .query("groupTargets", (p) =>
          p
            .withInput(gatewayBudgetApiOrganizationInputSchema)
            .withOutput(gatewayBudgetGroupTargetsSchema)
            .withPermission("gatewayBudgets:create")
            .handle(async ({ ctx, input }) =>
              ctx.app.gateway.listGroupTargets(input.organizationId),
            ),
        )
        .mutation("create", (p) =>
          p
            .withInput(gatewayBudgetApiCreateInputSchema)
            .withOutput(gatewayBudgetDtoResponseSchema)
            .withPermission("gatewayBudgets:create")
            .handle(async ({ ctx, input }) => {
              const row = await ctx.app.gateway.createBudget({
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
                actorUserId: ctx.actor().id,
              });
              return toDto(row);
            }),
        )
        .mutation("update", (p) =>
          p
            .withInput(gatewayBudgetApiUpdateInputSchema)
            .withOutput(gatewayBudgetDtoResponseSchema)
            .withPermission("gatewayBudgets:update")
            .handle(async ({ ctx, input }) => {
              const row = await ctx.app.gateway.updateBudget({
                ...input,
                actorUserId: ctx.actor().id,
              });
              return toDto(row);
            }),
        )
        .mutation("archive", (p) =>
          p
            .withInput(gatewayBudgetApiBudgetInputSchema)
            .withOutput(gatewayBudgetDtoResponseSchema)
            .withPermission("gatewayBudgets:delete")
            .handle(async ({ ctx, input }) => {
              const row = await ctx.app.gateway.archiveBudget({
                ...input,
                actorUserId: ctx.actor().id,
              });
              return toDto(row);
            }),
        )
        .mutation("reset", (p) =>
          p
            .withInput(gatewayBudgetApiResetInputSchema)
            .withOutput(gatewayBudgetDtoResponseSchema)
            .withPermission("gatewayBudgets:update")
            .handle(async ({ ctx, input }) => {
              const row = await ctx.app.gateway.resetBudget({
                id: input.id,
                organizationId: input.organizationId,
                actorUserId: ctx.actor().id,
                endUserId: input.endUserId ?? null,
                reason: input.reason ?? null,
              });
              return toDto(row);
            }),
        )
        .build()
    );
  }
}
