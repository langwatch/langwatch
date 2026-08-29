/**
 * Gateway usage reads over the process's tRPC transport.
 *
 * Historical spend from the ClickHouse `trace_summaries` cost path — the same
 * source the keys table's "Spent this month" column reads — grouped by key,
 * model and day.
 *
 * Organization-scoped, like the virtual-keys surface: usage spans every project
 * of the organization, because traces land in a key's trace destination rather
 * than in whichever project the viewer has selected. Visibility follows the same
 * membership rule as the keys table, so the page and the table agree on which
 * keys exist and what they spent.
 *
 * Transport only. Membership visibility and the usage reader both need
 * persistence this transport does not hold, so the feature's application holds
 * them.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { VirtualKeyNotFoundError } from "@langwatch/gateway-contract";
import type { GatewayApp } from "#app/gateway.app";

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewayUsageTrpcContext = Readonly<{
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type GatewayUsageTrpcProcedures<
  TContext extends GatewayUsageTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The declaration for a procedure whose scope is data the resolver loads at
   * runtime, so the resolver performs the real check. Records why, and which
   * permissions it enforces.
   */
  resolverAuthorizedPolicy(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureDecorator;
}>;

const summaryInputSchema = z.object({
  organizationId: z.string(),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
});

const summaryForVirtualKeyInputSchema = z.object({
  organizationId: z.string(),
  virtualKeyId: z.string(),
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  /** Narrows the recent-activity list, and nothing else, to one model. */
  model: z.string().min(1).max(256).optional(),
});

/** Installs the complete `gatewayUsage.*` tRPC surface on a process root. */
export class GatewayUsageTrpcApi {
  static create<
    TContext extends GatewayUsageTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewayUsageTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, resolverAuthorizedPolicy } = procedures;

    return trpc.router({
      // Membership-based like virtualKeys.list: the summary totals the keys
      // the caller can see, so its numbers reconcile with the table a click
      // arrives from. A non-member sees no keys and gets an empty summary.
      summary: resolverAuthorizedPolicy({
        reason:
          "usage is summed only over the keys the caller's membership in this organization makes visible; the membership filter in the resolver is the check",
        permissions: ["gatewayUsage:view"],
      })(procedure.input(summaryInputSchema)).query(async ({ ctx, input }) => {
        const keys = await ctx.app.gateway.listVisibleVirtualKeys({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
        });
        return ctx.app.gateway.usage.summary({
          organizationId: input.organizationId,
          virtualKeyIds: keys.map((k) => k.id),
          window: {
            fromDate: new Date(input.fromDate),
            toDate: new Date(input.toDate),
          },
        });
      }),

      summaryForVirtualKey: resolverAuthorizedPolicy({
        reason:
          "the key is loaded within this organization and must be visible to the caller's membership set; a miss is answered as not found",
        permissions: ["gatewayUsage:view"],
      })(procedure.input(summaryForVirtualKeyInputSchema)).query(async ({ ctx, input }) => {
        // Same visibility rule as virtualKeys.get: a key the caller can't
        // see is indistinguishable from one that doesn't exist.
        const vk = await ctx.app.gateway.virtualKeys.getById(
          input.virtualKeyId,
          input.organizationId,
        );
        if (!vk) {
          throw new VirtualKeyNotFoundError();
        }
        const visible = await ctx.app.gateway.isVirtualKeyVisible({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
          virtualKey: vk,
        });
        if (!visible) {
          throw new VirtualKeyNotFoundError();
        }
        return ctx.app.gateway.usage.summaryForVirtualKey({
          organizationId: input.organizationId,
          virtualKeyId: input.virtualKeyId,
          window: {
            fromDate: new Date(input.fromDate),
            toDate: new Date(input.toDate),
          },
          model: input.model,
        });
      }),
    });
  }
}
