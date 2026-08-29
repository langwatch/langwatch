/**
 * What an organization has used against what its plan allows, over the
 * process's tRPC transport.
 *
 *   getUsage:                          the usage panel on the subscription
 *                                      screen — counts, allowances and the
 *                                      pre-formatted copy beside them.
 *   checkAndSendUsageLimitNotification: sends the administrators the
 *                                      approaching-limit email, once per
 *                                      window.
 *
 * `entitlement` owns what a plan allows, and both procedures are readings
 * against that allowance, which is why they live here.
 *
 * The read takes `organization:view` — every member sees the allowance they
 * are working inside. The notification takes `organization:manage`: it takes
 * caller-supplied counts and mails the organization's administrators, so a
 * non-admin must not be able to trigger an admin-targeted message with
 * arbitrary numbers.
 *
 * Transport only: gates, input parsing and delegation to the process's usage
 * reader and its notifier, both of which are composed over the deployment's
 * billing store.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

/** The operator, as the usage reader identifies them for the plan lookup. */
type LimitsTrpcUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type LimitsTrpcContext = Readonly<{
  session: Readonly<{ user: LimitsTrpcUser }> | null;
}>;

type LimitsTrpcProcedures<
  TContext extends LimitsTrpcContext,
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

/**
 * The process capabilities this transport needs.
 *
 * Both answers are the deployment's own wire shapes — the usage panel's and
 * the notification row's — forwarded through this transport untouched, so
 * `create` is generic over the concrete ports and the router's inferred
 * output is the real shape rather than the constraint's.
 */
export type LimitsTrpcPorts = Readonly<{
  /**
   * Counts, allowances and the pre-formatted copy the panel renders. Takes
   * the operator because the allowance it measures against is the plan
   * resolved for them.
   */
  getUsageStats(
    ctx: LimitsTrpcContext,
    input: Readonly<{ organizationId: string; user: LimitsTrpcUser }>,
  ): Promise<unknown>;
  /**
   * Sends the approaching-limit email if this reading crosses the threshold
   * and nothing has been sent in the current window. Answers the notification
   * row it wrote, or nothing when it sent nothing.
   */
  checkAndSendWarning(
    ctx: LimitsTrpcContext,
    input: Readonly<{
      organizationId: string;
      currentMonthMessagesCount: number;
      maxMonthlyUsageLimit: number;
    }>,
  ): Promise<Readonly<{ id: string; sentAt: Date | null }> | null | undefined>;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

const usageLimitNotificationInputSchema = z.object({
  organizationId: z.string(),
  currentMonthMessagesCount: z.number(),
  maxMonthlyUsageLimit: z.number(),
});

/** Installs the complete `limits.*` tRPC surface on a process-owned root. */
export class LimitsTrpcApi {
  static create<
    TContext extends LimitsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends LimitsTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LimitsTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getUsage: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ input, ctx }) => {
          const user = ctx.session?.user;
          // `protectedProcedure` has already refused an anonymous caller;
          // this only narrows the type.
          if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
          return ports.getUsageStats(ctx, {
            organizationId: input.organizationId,
            user,
          });
        },
      ),

      checkAndSendUsageLimitNotification: policy("organization:manage")(
        procedure.input(usageLimitNotificationInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const notification = await ports.checkAndSendWarning(ctx, {
          organizationId: input.organizationId,
          currentMonthMessagesCount: input.currentMonthMessagesCount,
          maxMonthlyUsageLimit: input.maxMonthlyUsageLimit,
        });

        return {
          sent: notification !== null && notification !== undefined,
          notificationId: notification?.id,
          sentAt: notification?.sentAt,
        };
      }),
    });
  }
}
