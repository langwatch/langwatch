/**
 * The plan's enforced limits over the process's tRPC transport.
 *
 *   checkLimit:         whether one limit still allows creating another
 *                       resource — what a create button asks before it renders.
 *   checkAllLimits:     the same answer for every limit at once, for a
 *                       dashboard or a settings page.
 *   reportLimitBlocked: a client pre-check refused somebody, and operations
 *                       should hear about it.
 *
 * Reading a limit takes `organization:view`, which every member holds: a member
 * who cannot invite anybody should still be told the seats are full rather than
 * shown a control that fails.
 *
 * Transport only: gates, input shapes and delegation to `LicensingApp`. The
 * enforcement check and the error channel are dependencies of that application
 * rather than a second bag declared here, so a limit answered from a create
 * button and the license that sets it are answered from one object. The
 * operations notification is a second feature's slice on the context.
 */
import { limitTypeSchema, type LimitType } from "@langwatch/enterprise-licensing-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { LicensingApp, LicensingCaller } from "#app/licensing.app";

/**
 * The caller, as the enforcement service classifies them. The application
 * names the shape, so a limit answered here and a limit answered by the
 * license surface are answered about the same person.
 */
type LimitActor = LicensingCaller;

/**
 * The process supplies authentication; authorization arrives as a policy.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them. `usageLimits` is a second
 * feature's slice: an alert must be raised through the same composition that
 * answered the check.
 */
export type LicenseEnforcementTrpcContext = Readonly<{
  app: Readonly<{
    licensing: LicensingApp;
    usageLimits: Readonly<{
      notifyResourceLimitReached(
        input: Readonly<{
          organizationId: string;
          limitType: LimitType;
          current: number;
          max: number;
        }>,
      ): Promise<void>;
    }>;
  }>;
  actor(): Readonly<{ id: string }>;
  session: Readonly<{ user: LimitActor }> | null;
}>;

type LicenseEnforcementTrpcProcedures<
  TContext extends LicenseEnforcementTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission, applied AFTER this feature's own
   * input parser so the check reads its organization id from validated input.
   */
  policy(permission: "organization:view"): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

const limitScopeSchema = z.object({
  organizationId: z.string(),
  limitType: limitTypeSchema,
});

/** Installs the complete `licenseEnforcement.*` surface on a process root. */
export class LicenseEnforcementTrpcApi {
  static create<
    TContext extends LicenseEnforcementTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LicenseEnforcementTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    /**
     * The caller as the enforcement service classifies them: a lite member is
     * counted differently from a full one, so an id alone cannot answer it.
     * `actor()` is the process's refusal for a request carrying no caller, and
     * it throws before the fallback below can be reached.
     */
    // The CONSTRAINT rather than the type parameter: a resolver is handed a
    // `Simplify<TContext>`, which satisfies the constraint and is not
    // assignable to `TContext`. This reads the session and the actor, both of
    // which the constraint declares.
    const callerOf = (ctx: LicenseEnforcementTrpcContext): LimitActor => {
      const actor = ctx.actor();
      return ctx.session?.user ?? actor;
    };

    return trpc.router({
      /**
       * Whether a specific limit allows creating another resource. Ask before
       * showing a create button or form.
       */
      checkLimit: policy("organization:view")(procedure.input(limitScopeSchema)).query(
        async ({ ctx, input }) => {
          return ctx.app.licensing.checkLimit({
            organizationId: input.organizationId,
            limitType: input.limitType,
            user: callerOf(ctx),
          });
        },
      ),

      /**
       * Every limit at once, for dashboards and settings pages that show
       * several.
       *
       * WHICH limits "every limit" means is the application's, not this
       * door's: a surface that enumerated them here would go stale the day a
       * limit is added, and silently show one fewer.
       */
      checkAllLimits: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) =>
          ctx.app.licensing.checkAllLimits({
            organizationId: input.organizationId,
            user: callerOf(ctx),
          }),
      ),

      /**
       * Report that a UI pre-check blocked a user from creating a resource.
       *
       * Fire-and-forget from the client's perspective: the upgrade modal
       * appears immediately; this mutation triggers an ops notification as a
       * side effect. The server re-verifies the limit so a fabricated request
       * cannot trigger a false alert.
       */
      reportLimitBlocked: policy("organization:view")(procedure.input(limitScopeSchema)).mutation(
        async ({ ctx, input }) => {
          const result = await ctx.app.licensing.checkLimit({
            organizationId: input.organizationId,
            limitType: input.limitType,
            user: callerOf(ctx),
          });

          if (!result.allowed) {
            void ctx.app.usageLimits
              .notifyResourceLimitReached({
                organizationId: input.organizationId,
                limitType: input.limitType,
                current: result.current,
                max: result.max,
              })
              .catch((error: unknown) => ctx.app.licensing.reportError(error));
          }
        },
      ),
    });
  }
}
