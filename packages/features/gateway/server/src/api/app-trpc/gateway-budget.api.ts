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
import type { GatewayBudgetWithSeats, GatewayService } from "@langwatch/gateway-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import { effectiveBudgetPeriod } from "../../adapters/gateway-period.adapter";
import { providerLabelFor } from "../../repositories/prisma/prisma.gateway-provider-label.repository";
import { scopeTargetKey } from "../../repositories/prisma/prisma.gateway-budget-scope-target.repository";

type GatewayBudgetApplication = Readonly<{
  gateway: Readonly<{ budgetDecisions: GatewayService }>;
  /** Resolves the organization behind a project id, and nothing else. */
  projects: Pick<ProjectService, "tryGetOrganizationId">;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayBudgetTrpcContext = Readonly<{
  app: GatewayBudgetApplication;
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

/**
 * The reads this transport makes that are not the budget service's own.
 *
 * Consumed through a generic so the concrete shapes the process wires in
 * survive into the router's inferred output types instead of collapsing to the
 * loose constraint named here.
 */
export type GatewayBudgetTrpcPorts = Readonly<{
  /**
   * Refuses an organization id that names no organization, with the same
   * NOT_FOUND this surface has always answered. It is a tenancy anchor, not an
   * authorization check — the policy above is what decides access.
   */
  assertOrganizationExists(organizationId: string): Promise<void>;
  /** Provider row id to its display label, for the whole page in one read. */
  resolveProviderLabels(
    budgets: ReadonlyArray<{ providerKey: string | null }>,
  ): Promise<Map<string, string>>;
  /** The groups a per-member budget can target, with their sizes. */
  listGroupTargets(
    organizationId: string,
  ): Promise<ReadonlyArray<{ id: string; name: string; memberCount: number }>>;
}>;

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ORGANIZATION"),
    organizationId: z.string(),
  }),
  z.object({ kind: z.literal("TEAM"), teamId: z.string() }),
  z.object({ kind: z.literal("PROJECT"), projectId: z.string() }),
  z.object({ kind: z.literal("VIRTUAL_KEY"), virtualKeyId: z.string() }),
  z.object({ kind: z.literal("PRINCIPAL"), principalUserId: z.string() }),
  // Per-member group budgets. Creation is service-guarded: it needs
  // the ClickHouse spend path (group_budget_requires_clickhouse otherwise).
  z.object({ kind: z.literal("GROUP"), groupId: z.string() }),
]);

const organizationScopeSchema = z.object({ organizationId: z.string() });
const budgetIdSchema = z.object({ organizationId: z.string(), id: z.string() });

const createInputSchema = z.object({
  organizationId: z.string(),
  scope: scopeSchema,
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  window: z.enum(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL", "MANUAL"]),
  limitUsd: z.number().positive().or(z.string()),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
  // ModelProvider row id. Null / absent = the budget counts every
  // provider; set = it counts and constrains only that provider.
  providerKey: z.string().nullable().optional(),
  // Phases a cyclic window off this instant instead of the calendar.
  // Absent keeps the calendar alignment. Rejected on TOTAL and
  // MANUAL, which do not cycle.
  //
  // A Date, or an ISO string carrying its offset, and nothing looser:
  // the same instant the REST surface demands. An offsetless string
  // would be read in whichever zone the server process happens to run
  // in, so the anchor a customer set would land on a different instant
  // per deployment.
  cycleAnchorAt: z
    .union([
      z.date(),
      z
        .string()
        .datetime({ offset: true })
        .transform((iso) => new Date(iso)),
    ])
    .nullable()
    .optional(),
  // Keeps a team / project / group budget no active key can reach,
  // which is otherwise refused. Provisioning ahead of the keys that
  // will use it is legitimate, so the guardrail is not a prohibition.
  allowUnreachable: z.boolean().optional(),
});

const updateInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  limitUsd: z.number().positive().or(z.string()).optional(),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
});

const resetInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
  endUserId: z.string().optional(),
  reason: z.string().max(500).optional(),
});

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
    TPorts extends GatewayBudgetTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayBudgetTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("gatewayBudgets:view")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) => {
          await ports.assertOrganizationExists(input.organizationId);
          const { budgets, spendAvailable, scopeReach } =
            await ctx.app.gateway.budgetDecisions.listWithHealth(input.organizationId);
          const scopeTargets = await ctx.app.gateway.budgetDecisions.resolveScopeTargets(
            budgets,
            input.organizationId,
          );
          const providerLabels = await ports.resolveProviderLabels(budgets);
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
        },
      ),

      listForProject: policy("gatewayBudgets:view")(
        procedure.input(z.object({ projectId: z.string() })),
      ).query(async ({ ctx, input }) => {
        const { budgets, spendAvailable, scopeReach } =
          await ctx.app.gateway.budgetDecisions.listForProjectWithHealth(input.projectId);
        // The organization the project belongs to, so VIRTUAL_KEY / GROUP /
        // PRINCIPAL targets resolve inside the right tenant. Read through the
        // Project service rather than a Prisma client, which this transport
        // does not hold.
        const organizationId = await ctx.app.projects.tryGetOrganizationId(input.projectId);
        const scopeTargets = await ctx.app.gateway.budgetDecisions.resolveScopeTargets(
          budgets,
          organizationId ?? null,
        );
        const providerLabels = await ports.resolveProviderLabels(budgets);
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

      get: policy("gatewayBudgets:view")(procedure.input(budgetIdSchema)).query(
        async ({ ctx, input }) => {
          await ports.assertOrganizationExists(input.organizationId);
          const detail = await ctx.app.gateway.budgetDecisions.tryGetDetail(
            input.id,
            input.organizationId,
          );
          if (!detail) {
            throw new TRPCError({ code: "NOT_FOUND", message: "budget not found" });
          }
          const providerLabels = await ports.resolveProviderLabels([detail.budget]);
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
        procedure.input(organizationScopeSchema),
      ).query(async ({ input }) => ports.listGroupTargets(input.organizationId)),

      create: policy("gatewayBudgets:create")(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }) => {
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
        },
      ),

      update: policy("gatewayBudgets:update")(procedure.input(updateInputSchema)).mutation(
        async ({ ctx, input }) => {
          const row = await ctx.app.gateway.budgetDecisions.update({
            ...input,
            actorUserId: ctx.actor().id,
          });
          return toDto(row);
        },
      ),

      archive: policy("gatewayBudgets:delete")(procedure.input(budgetIdSchema)).mutation(
        async ({ ctx, input }) => {
          const row = await ctx.app.gateway.budgetDecisions.archive({
            ...input,
            actorUserId: ctx.actor().id,
          });
          return toDto(row);
        },
      ),

      reset: policy("gatewayBudgets:update")(procedure.input(resetInputSchema)).mutation(
        async ({ ctx, input }) => {
          const row = await ctx.app.gateway.budgetDecisions.reset({
            id: input.id,
            organizationId: input.organizationId,
            actorUserId: ctx.actor().id,
            endUserId: input.endUserId ?? null,
            reason: input.reason ?? null,
          });
          return toDto(row);
        },
      ),
    });
  }
}
