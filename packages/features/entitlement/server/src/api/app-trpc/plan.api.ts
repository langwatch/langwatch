/**
 * The organization's active plan over the process's tRPC transport.
 *
 * One procedure. `entitlement` is the feature that owns what a plan allows,
 * and `PlanProvider` is its contract, so the read that answers "which plan is
 * this organization on" belongs here rather than in the application.
 *
 * `organization:view`, because every member sees which plan they are on — the
 * banners, the upgrade prompts and the limit copy all read it.
 *
 * Transport only: the gate, the input parser and delegation to the process's
 * plan provider. WHICH provider answers (a signed licence, a subscription
 * row, or the unlicensed baseline) is a deployment decision the process makes.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Plan, PlanProvider } from "@langwatch/entitlement-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

type PlanApplication = Readonly<{
  planProvider: Pick<PlanProvider, "getActivePlan">;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type PlanTrpcContext = Readonly<{
  app: PlanApplication;
  session: Readonly<{
    user: Readonly<{ id?: string; name?: string | null; email?: string | null }>;
  }> | null;
}>;

type PlanTrpcProcedures<
  TContext extends PlanTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

/** Installs the complete `plan.*` tRPC surface on a process-owned root. */
export class PlanTrpcApi {
  static create<
    TContext extends PlanTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PlanTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getActivePlan: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ input, ctx }): Promise<Plan> =>
          await ctx.app.planProvider.getActivePlan({
            organizationId: input.organizationId,
            user: ctx.session?.user,
          }),
      ),
    });
  }
}
