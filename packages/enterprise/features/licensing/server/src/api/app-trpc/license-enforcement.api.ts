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
 * Transport only: gates, input shapes and delegation. The enforcement service,
 * the operations notification and the error reporter arrive as ports, because
 * none of them is licensing's own.
 */
import {
  limitTypeSchema,
  limitTypes,
  type LimitCheckResult,
  type LimitType,
} from "@langwatch/enterprise-licensing-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/**
 * The caller, as the enforcement service classifies them. Structural rather
 * than imported: the service's own notion of a member lives with the process
 * that composes it, and this surface only passes it straight through.
 */
type LimitActor = Readonly<{ id: string; email?: string | null }>;

/**
 * The process supplies authentication; authorization arrives as a policy. The
 * usage-limit notifier comes from the request's own application rather than a
 * port, because an alert must be raised through the same composition that
 * answered the check.
 */
export type LicenseEnforcementTrpcContext = Readonly<{
  app: Readonly<{
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

/** The process capabilities this transport needs that are not licensing's own. */
export type LicenseEnforcementTrpcPorts = Readonly<{
  /** Whether one limit still admits another resource, for this caller. */
  checkLimit(
    input: Readonly<{
      organizationId: string;
      limitType: LimitType;
      user: LimitActor;
    }>,
  ): Promise<LimitCheckResult>;
  /** Swallows a notification failure into the process's error channel. */
  reportError(error: unknown): void;
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
    TPorts extends LicenseEnforcementTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LicenseEnforcementTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    /**
     * The caller as the enforcement service classifies them: a lite member is
     * counted differently from a full one, so an id alone cannot answer it.
     * `actor()` is the process's refusal for a request carrying no caller, and
     * it throws before the fallback below can be reached.
     */
    const callerOf = (ctx: TContext): LimitActor => {
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
          return ports.checkLimit({
            organizationId: input.organizationId,
            limitType: input.limitType,
            user: callerOf(ctx),
          });
        },
      ),

      /**
       * Every limit at once, for dashboards and settings pages that show
       * several.
       */
      checkAllLimits: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) => {
          const user = callerOf(ctx);
          const results = await Promise.all(
            limitTypes.map((type) =>
              ports.checkLimit({
                organizationId: input.organizationId,
                limitType: type,
                user,
              }),
            ),
          );
          return Object.fromEntries(results.map((result) => [result.limitType, result])) as Record<
            (typeof limitTypes)[number],
            (typeof results)[number]
          >;
        },
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
          const result = await ports.checkLimit({
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
              .catch((error: unknown) => ports.reportError(error));
          }
        },
      ),
    });
  }
}
