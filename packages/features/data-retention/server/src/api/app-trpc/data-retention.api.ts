import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  INDEFINITE_RETENTION_DAYS,
  killRetroactiveMutationInputSchema,
  retentionCategorySchema,
  retentionDaysInputSchema,
  retentionScopeSchema,
  retroactiveMutationProjectInputSchema,
  ScopeTargetNotFoundError,
  type DataRetentionService,
  type RetentionScopeType,
} from "@langwatch/data-retention-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type DataRetentionApplication = Readonly<{ dataRetention: DataRetentionService }>;

/** One retention target: the tier plus the organization, team or project id. */
export type RetentionScopeTarget = Readonly<{
  scopeType: RetentionScopeType;
  scopeId: string;
}>;

/** The process supplies authentication, authorization and audit policy. */
export type DataRetentionTrpcContext = Readonly<{
  app: DataRetentionApplication;
  actor(): Readonly<{ id: string }>;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
}>;

/**
 * The retention policy the process owns, because every decision here resolves
 * organization/team/project lineage and an active plan out of the process's own
 * identity and billing stores rather than out of retention state:
 *
 * - which callers may write an override at a given tier,
 * - which retention values the scope's owning plan may persist,
 * - who may disable retention entirely (keep data forever),
 * - and the two RBAC-filtered reads the settings page renders.
 *
 * Each method is handed the request context so the process resolves the caller
 * exactly as it always did. Throwing is how a refusal is expressed; this
 * adapter never converts a policy refusal into a different answer.
 */
export type DataRetentionTrpcPolicy<TSnapshot, TStorageUsage> = Readonly<{
  /** Refuses a caller who may not write a retention override at `scope`. */
  assertCanWriteScope(ctx: DataRetentionTrpcContext, scope: RetentionScopeTarget): Promise<void>;
  /** Refuses a plan that may not persist `retentionDays` at `scope`. */
  assertWriteAllowed(
    ctx: DataRetentionTrpcContext,
    scope: RetentionScopeTarget,
    retentionDays: number,
  ): Promise<void>;
  /** Refuses everyone but a platform administrator. */
  assertCanDisableRetention(ctx: DataRetentionTrpcContext): void;
  /** Refuses a free plan on the organization that owns `scope`. */
  assertPlanForScope(ctx: DataRetentionTrpcContext, scope: RetentionScopeTarget): Promise<void>;
  /** Refuses a free plan on the organization that owns `projectId`. */
  assertPlanForProject(ctx: DataRetentionTrpcContext, projectId: string): Promise<void>;
  getPolicySnapshot(
    ctx: DataRetentionTrpcContext,
    params: Readonly<{ projectId: string }>,
  ): Promise<TSnapshot>;
  getScopeStorageUsage(
    ctx: DataRetentionTrpcContext,
    params: Readonly<{ projectId: string; scope: RetentionScopeTarget }>,
  ): Promise<TStorageUsage>;
}>;

type DataRetentionTrpcProcedures<
  TContext extends DataRetentionTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TSnapshot,
  TStorageUsage,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy: DataRetentionTrpcPolicy<TSnapshot, TStorageUsage>;
}>;

const scopeInput = z.object({
  scopeType: retentionScopeSchema,
  scopeId: z.string().min(1),
});

const triggerRetroactiveMutationInputSchema = retroactiveMutationProjectInputSchema.extend({
  category: retentionCategorySchema,
});

/**
 * Installs the complete legacy `dataRetention.*` tRPC surface on a
 * process-owned root. The procedure is injected by the process so its auth,
 * audit, error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class DataRetentionTrpcApi {
  static create<
    TContext extends DataRetentionTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TSnapshot,
    TStorageUsage,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: DataRetentionTrpcProcedures<
      TContext,
      TOptions,
      TRoot,
      TSnapshot,
      TStorageUsage
    >,
  ) {
    const procedure = procedures.protected;
    const policy = procedures.policy;

    return trpc.router({
      /**
       * The retention settings snapshot for a project: effective per-category
       * retention, the readable override rules, and the writable scopes for the
       * chip picker. Read access is project:view; the snapshot RBAC-filters what
       * it returns.
       */
      getRules: procedure
        .input(z.object({ projectId: z.string() }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("project:view", { projectId: input.projectId });
          return policy.getPolicySnapshot(ctx, { projectId: input.projectId });
        }),

      /**
       * Set one category's retention at one scope. Authorizes write on the target
       * scope (organization:manage / team:manage / project:update) — a project
       * member can edit their own project's retention but cannot push a policy up
       * to the org. `projectId` is deliberately not acted on: the authorized
       * target is `scope`, and both policy checks below run against the scope's
       * own organization.
       */
      setForScope: procedure
        .input(
          z.object({
            projectId: z.string(),
            scope: scopeInput,
            category: retentionCategorySchema,
            retentionDays: retentionDaysInputSchema,
          }),
        )
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await policy.assertCanWriteScope(ctx, input.scope);
          // Plan-gate against the scope's owning org, not the caller-supplied
          // projectId (the two can belong to different orgs). Resolves the org +
          // plan once, then applies the free gate AND the value gate: paid plans
          // may persist only their fixed presets; enterprise/self-hosted keep the
          // full range + custom (>=49). No-ops on the indefinite sentinel so the
          // platform-admin check below still runs. The write-path prevention — the
          // UI menu is a mirror, not the enforcement.
          await policy.assertWriteAllowed(ctx, input.scope, input.retentionDays);
          // Disabling retention (indefinite/keep-forever) is platform-admin only.
          // The schema accepts the 0 sentinel structurally; this is where the
          // capability is actually authorized — independent of org/team RBAC.
          if (input.retentionDays === INDEFINITE_RETENTION_DAYS) {
            policy.assertCanDisableRetention(ctx);
          }
          try {
            return await ctx.app.dataRetention.setForScope({
              scope: input.scope,
              category: input.category,
              retentionDays: input.retentionDays,
            });
          } catch (error) {
            if (error instanceof ScopeTargetNotFoundError) {
              throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            }
            throw error;
          }
        }),

      /**
       * Preview the retention each category would fall back to if the scope's
       * override were removed — the cascade value (next tier, or the platform
       * default) the data would land on. Powers the remove-confirmation dialog so
       * the user sees the real post-removal number, never a guessed one. Read-only;
       * gated by the same write-on-scope check as the removal it previews, so the
       * resolved org-default never leaks to a caller who couldn't remove the rule.
       */
      previewScopeRemoval: procedure
        .input(z.object({ projectId: z.string(), scope: scopeInput }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await policy.assertCanWriteScope(ctx, input.scope);
          return ctx.app.dataRetention.previewScopeRemoval({ scope: input.scope });
        }),

      /** Remove one category's override at one scope; the next tier then applies. */
      removeForScope: procedure
        .input(
          z.object({
            projectId: z.string(),
            scope: scopeInput,
            category: retentionCategorySchema,
          }),
        )
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await policy.assertCanWriteScope(ctx, input.scope);
          await policy.assertPlanForScope(ctx, input.scope);
          await ctx.app.dataRetention.removeForScope({
            scope: input.scope,
            category: input.category,
          });
        }),

      triggerRetroactiveUpdate: procedure
        .input(triggerRetroactiveMutationInputSchema)
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("project:update", { projectId: input.projectId });
          await policy.assertPlanForProject(ctx, input.projectId);
          // Resolve the retention value server-side. Trusting a client-supplied
          // newRetentionDays would let a project:update caller rewrite existing
          // rows to any value, irreversibly contracting data without a matching
          // saved rule. The cascade-aware resolver is the only legitimate
          // source: PROJECT > TEAM > ORGANIZATION > platform default. When the
          // caller saves an org-wide override but a closer project override
          // already wins, the resolved value REMAINS the project's existing
          // value — so retroactive rewrite uses that, not the broader scope's
          // value. We return `appliedRetentionDays` to the UI so it can show
          // the truth (the dialog previously named the form value, which
          // could differ silently from what got applied).
          const effective = await ctx.app.dataRetention.getResolvedForProject({
            projectId: input.projectId,
          });
          const category = input.category;
          const newRetentionDays = effective[category];
          if (newRetentionDays === undefined) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `No effective retention is resolvable for category ${category}.`,
            });
          }
          const result = await ctx.app.dataRetention.triggerRetroactiveUpdate({
            projectId: input.projectId,
            category,
            newRetentionDays,
          });
          return { ...result, appliedRetentionDays: newRetentionDays };
        }),

      getMutationProgress: procedure
        .input(retroactiveMutationProjectInputSchema)
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("traces:view", { projectId: input.projectId });
          return ctx.app.dataRetention.getRetroactiveMutationProgress({
            projectId: input.projectId,
          });
        }),

      killMutation: procedure
        .input(killRetroactiveMutationInputSchema)
        .mutation(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("project:update", { projectId: input.projectId });
          await policy.assertPlanForProject(ctx, input.projectId);
          await ctx.app.dataRetention.killRetroactiveMutation({
            projectId: input.projectId,
            mutationId: input.mutationId,
          });
        }),

      /**
       * Total stored bytes for the projects the scope selector resolves to, summed
       * across every in-scope project the caller can read. Lets the Data Storage
       * card reflect the chosen scope (organization / team / project) instead of
       * always showing only the current project. RBAC-filtering happens inside the
       * resolver against the scope's owning org, so a wider scope never leaks a
       * project's storage the caller couldn't see.
       */
      getScopeStorageUsage: procedure
        .input(z.object({ projectId: z.string(), scope: scopeInput }))
        .query(async ({ ctx, input }) => {
          ctx.actor();
          await ctx.authorize("traces:view", { projectId: input.projectId });
          return policy.getScopeStorageUsage(ctx, {
            projectId: input.projectId,
            scope: input.scope,
          });
        }),
    });
  }
}
