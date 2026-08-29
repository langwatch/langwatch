/**
 * Gateway budget administration over the process's tRPC transport.
 *
 * A budget is always organization-scoped, but the thing it constrains is one of
 * ORGANIZATION / TEAM / PROJECT / VIRTUAL_KEY / PRINCIPAL / GROUP. The screens
 * pass a scope kind plus the target id; normalising that onto `scopeType` and
 * the matching typed column is the service's job, not this transport's.
 *
 * Transport only: procedure names, input parsing, the wire DTO, and delegation
 * to the process's one budget-decision service. The two reads this surface
 * makes that are not the budget service's own — proving the organization
 * exists, and resolving provider display labels and group targets — arrive as
 * ports rather than a Prisma client, so no persistence reaches the transport.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  gatewayBudgetApiBudgetInputSchema,
  gatewayBudgetApiCreateInputSchema,
  gatewayBudgetApiOrganizationInputSchema,
  gatewayBudgetApiProjectInputSchema,
  gatewayBudgetApiResetInputSchema,
  gatewayBudgetApiUpdateInputSchema,
  scopeTargetKey,
  type GatewayBudgetWithSeats,
} from "@langwatch/gateway-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { effectiveBudgetPeriod } from "../../adapters/gateway-period.adapter";
import { providerLabelFor } from "../../repositories/prisma/prisma.gateway-provider-label.repository";
import type { GatewayApp } from "#app/gateway.app";

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayBudgetTrpcContext = Readonly<{
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * A process middleware chain applied to one already-parsed procedure.
 *
 * Returned rather than composed ahead of `.input()`, because tRPC appends the
 * input parser at the point it is called: a check installed before it reads
 * `input === undefined`, and every declaration here takes its scope id from the
 * validated input.
 */
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
    currentPeriodStartedAt: period.currentPeriodStartedAt.toISOString(),
    resetsAt: period.resetsAt.toISOString(),
    /** Null is calendar alignment; set, it is the phase the window cycles on. */
    cycleAnchorAt: b.cycleAnchorAt?.toISOString() ?? null,
    lastResetAt: b.lastResetAt?.toISOString() ?? null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
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
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("gatewayBudgets:view")(
        procedure.input(gatewayBudgetApiOrganizationInputSchema),
      ).query(async ({ ctx, input }) => {
        await ctx.app.gateway.assertOrganizationExists(input.organizationId);
        const { budgets, spendAvailable, scopeReach } =
          await ctx.app.gateway.budgetDecisions.listWithHealth(input.organizationId);
        const scopeTargets = await ctx.app.gateway.budgetDecisions.resolveScopeTargets(
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
            providerLabel: providerLabelFor(providerLabels, b.providerKey),
          })),
        };
      }),

      listForProject: policy("gatewayBudgets:view")(
        procedure.input(gatewayBudgetApiProjectInputSchema),
      ).query(async ({ ctx, input }) => {
        const { budgets, spendAvailable, scopeReach } =
          await ctx.app.gateway.budgetDecisions.listForProjectWithHealth(input.projectId);
        // The organization the project belongs to, so VIRTUAL_KEY / GROUP /
        // PRINCIPAL targets resolve inside the right tenant. Read through the
        // Project service rather than a Prisma client, which this transport
        // does not hold.
        const organizationId = await ctx.app.gateway.projects.tryGetOrganizationId(input.projectId);
        const scopeTargets = await ctx.app.gateway.budgetDecisions.resolveScopeTargets(
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
            providerLabel: providerLabelFor(providerLabels, b.providerKey),
          })),
        };
      }),

      get: policy("gatewayBudgets:view")(procedure.input(gatewayBudgetApiBudgetInputSchema)).query(
        async ({ ctx, input }) => {
          await ctx.app.gateway.assertOrganizationExists(input.organizationId);
          const detail = await ctx.app.gateway.budgetDecisions.tryGetDetail(
            input.id,
            input.organizationId,
          );
          if (!detail) {
            throw new TRPCError({ code: "NOT_FOUND", message: "budget not found" });
          }
          const providerLabels = await ctx.app.gateway.resolveProviderLabels([detail.budget]);
          return {
            ...toDto(detail.budget),
            spendAvailable: detail.spendAvailable,
            unreachableByAnyKey: detail.unreachableByAnyKey,
            scopeTarget: detail.scopeTarget,
            providerLabel: providerLabelFor(providerLabels, detail.budget.providerKey),
            recentLedger: detail.recentLedger.map((l) => ({
              id: l.id,
              virtualKeyId: l.virtualKeyId,
              virtualKeyName: l.virtualKey?.name ?? l.virtualKeyId,
              virtualKeyPrefix: l.virtualKey?.displayPrefix ?? "",
              amountUsd: l.amountUsd.toString(),
              model: l.model,
              status: l.status,
              occurredAt: l.occurredAt.toISOString(),
            })),
          };
        },
      ),

      /**
       * The groups a budget can target, for whoever may create budgets.
       * `group.listAll` exposes role-binding maps and demands
       * organization:manage; a budget creator only needs names and sizes, so
       * this stays gated by the same permission as the create it serves.
       */
      groupTargets: policy("gatewayBudgets:create")(
        procedure.input(gatewayBudgetApiOrganizationInputSchema),
      ).query(async ({ ctx, input }) => ctx.app.gateway.listGroupTargets(input.organizationId)),

      create: policy("gatewayBudgets:create")(
        procedure.input(gatewayBudgetApiCreateInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const row = await ctx.app.gateway.budgetDecisions.create({
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

      update: policy("gatewayBudgets:update")(
        procedure.input(gatewayBudgetApiUpdateInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const row = await ctx.app.gateway.budgetDecisions.update({
          ...input,
          actorUserId: ctx.actor().id,
        });
        return toDto(row);
      }),

      archive: policy("gatewayBudgets:delete")(
        procedure.input(gatewayBudgetApiBudgetInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const row = await ctx.app.gateway.budgetDecisions.archive({
          ...input,
          actorUserId: ctx.actor().id,
        });
        return toDto(row);
      }),

      reset: policy("gatewayBudgets:update")(
        procedure.input(gatewayBudgetApiResetInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const row = await ctx.app.gateway.budgetDecisions.reset({
          id: input.id,
          organizationId: input.organizationId,
          actorUserId: ctx.actor().id,
          endUserId: input.endUserId ?? null,
          reason: input.reason ?? null,
        });
        return toDto(row);
      }),
    });
  }
}
