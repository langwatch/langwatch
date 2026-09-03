/**
 * The /me dashboard's governance reads, over the process's tRPC transport.
 *
 * Three procedures — the member's usage rollup, the budgets that bind their
 * own keys, and the CLI's login-completion bootstrap. Every answer is the
 * governance contract's own wire shape, which is why they live in this
 * package: they were assembled in the application beside the packaged `user.*`
 * surface, and a core feature package may not name an Enterprise contract
 * (`langwatch/package-boundaries`), so the choice was restating the contract
 * there or owning the procedures here. They are the governance feature's.
 *
 * The process merges this router into the `user` namespace, which is the name
 * the /me page and the CLI have always called: `user.personalUsage`,
 * `user.budgetOverview`, `user.cliBootstrap`. Ownership is a fact about the
 * code; the namespace is a fact about the wire.
 *
 * Every procedure acts on the SESSION's user — the caller's id comes from
 * `ctx.actor()` and never from input, so no cross-user reach is expressible.
 * `organization:view` is the entry gate on all three.
 *
 * Transport only: input parsing, the membership refusal, and delegation to
 * {@link GovernanceApp}.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { GovernanceApp } from "#app/governance.app";

/**
 * The process supplies authentication; authorization arrives as the policy.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type PersonalDashboardTrpcContext = Readonly<{
  app: Readonly<{ governanceApp: GovernanceApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type PersonalDashboardTrpcProcedures<
  TContext extends PersonalDashboardTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check and audit for
   * one declared permission, applied AFTER this feature's input parser.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const personalUsageSchema = z.object({
  organizationId: z.string(),
  /** Defaults to start-of-current-month → now if omitted. */
  windowStartMs: z.number().optional(),
  windowEndMs: z.number().optional(),
});

const budgetOverviewSchema = z.object({
  organizationId: z.string(),
  includeTopModels: z.boolean().optional(),
});

const cliBootstrapSchema = z.object({ organizationId: z.string() });

/** Installs the /me dashboard's governance procedures on a process root. */
export class PersonalDashboardTrpcApi {
  static create<
    TContext extends PersonalDashboardTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PersonalDashboardTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * Per-user usage rollup powering the /me dashboard cards, charts and
       * recent activity. Scoped to the caller's personal project (which by
       * definition has only their traces) unioned with the ingestion rows
       * recorded against them in the organization's governance tenant.
       *
       * Returns empty-state safe values (zeros, empty arrays, null model) when
       * no traces exist yet, so the page can render before the member's first
       * CLI request lands.
       */
      personalUsage: policy("organization:view")(procedure.input(personalUsageSchema)).query(
        async ({ ctx, input }) => {
          const caller = ctx.actor();
          await assertMember(ctx, caller.id, input.organizationId);

          return ctx.app.governanceApp.personalUsageDashboard(
            {
              organizationId: input.organizationId,
              window:
                input.windowStartMs && input.windowEndMs
                  ? { startMs: input.windowStartMs, endMs: input.windowEndMs }
                  : undefined,
            },
            caller,
          );
        },
      ),

      /**
       * Every budget that binds the caller's own keys in this organization,
       * each labelled with its scope ("whole organization budget", "team
       * budget (Core)", "personal budget"), most binding first. One source:
       * the same overview the CLI's budget-overview endpoint serves, so /me
       * and the login epilogue can never report different numbers for the same
       * budget.
       *
       * A caller with no gateway access gets an answer whose consumer renders
       * nothing budget-related.
       *
       * Authorization: members read their OWN overview only — the user id is
       * always the session's. `organization:view` is the entry gate; the
       * application re-checks membership itself, fail closed.
       */
      budgetOverview: policy("organization:view")(procedure.input(budgetOverviewSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.governanceApp.personalBudgetOverview(
            {
              organizationId: input.organizationId,
              includeTopModels: input.includeTopModels,
            },
            ctx.actor(),
          ),
      ),

      /**
       * CLI bootstrap data for the login-completion ceremony: inherited
       * providers (with display name and model list) plus the monthly budget
       * (limit and used).
       *
       * Empty-state safe: answers no providers and an unset monthly budget when
       * the member has no personal workspace yet.
       */
      cliBootstrap: policy("organization:view")(procedure.input(cliBootstrapSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.governanceApp.cliBootstrap({ organizationId: input.organizationId }, ctx.actor()),
      ),
    });
  }
}

/**
 * Membership, checked again after `organization:view`. The permission answers
 * "may this caller act on an organization at all"; this answers "is this one
 * theirs", which is what keeps a personal rollup inside the caller's own
 * tenant.
 *
 * The refusal is a transport error rather than a handled one because it is the
 * refusal this procedure has always sent, and it is the same one the packaged
 * `user.*` surface this router is merged with sends for the same question.
 */
async function assertMember(
  ctx: PersonalDashboardTrpcContext,
  userId: string,
  organizationId: string,
): Promise<void> {
  if (await ctx.app.governanceApp.isOrganizationMember({ userId, organizationId })) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: `Not a member of organization ${organizationId}`,
  });
}
