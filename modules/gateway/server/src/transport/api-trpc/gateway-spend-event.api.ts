/**
 * The gateway spend-event ledger over tRPC: a read-only, newest-first, cursor-paged view
 * over `gateway_spend`. Project-scoped, like the neighbouring usage reads; organization-wide
 * rollups are a later fast-follow.
 */
import { toDate } from "@langwatch/time";
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { gatewaySpendEventPageSchema } from "@langwatch/gateway-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { spendFiltersSchema } from "../../adapters/gateway-spend-filters.adapter.ts";
import type { GatewayApp } from "#app/gateway.app";

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewaySpendEventTrpcContext = Readonly<{
  app: Readonly<{ gateway: GatewayApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type GatewaySpendEventTrpcProcedures<
  TContext extends GatewaySpendEventTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** Applied after this feature's input parser: the check reads its scope id from it. */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const listInputSchema = z.object({
  projectId: z.string(),
  fromMs: z.number().int(),
  toMs: z.number().int(),
  // The same filter set the REST reads narrow on, in the structured
  // spelling rather than the query-string one, so the screen and a
  // reconciliation script cannot come to mean different things by the
  // same narrowing.
  filters: spendFiltersSchema.optional(),
  cursor: z
    .object({
      occurredAtMs: z.number().int(),
      gatewayRequestId: z.string(),
    })
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/** Installs the complete `gatewaySpendEvents.*` tRPC surface on a process root. */
export class GatewaySpendEventTrpcApi {
  static create<
    TContext extends GatewaySpendEventTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewaySpendEventTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("list", (p) =>
        p
          .withInput(listInputSchema)
          .withOutput(gatewaySpendEventPageSchema)
          .withPermission("gatewayUsage:view")
          .handle(async ({ ctx, input }) => {
            const service = ctx.app.gateway.getSpendEventsService();
            if (!service) {
              return {
                rows: [],
                nextCursor: null,
                virtualKeyNames: {} as Record<string, string>,
                clickHouseDisabled: true,
              };
            }
            const { rows, nextCursor } = await service.getSpendEventsPage({
              tenantId: input.projectId,
              fromMs: input.fromMs,
              toMs: input.toMs,
              filters: input.filters ?? {},
              cursor: input.cursor,
              limit: input.limit ?? 50,
            });

            const vkIds = [...new Set(rows.map((r) => r.virtualKeyId))].filter(
              (id) => id.length > 0,
            );
            // The ids come from this project's own tenant-filtered spend rows,
            // and the Project service resolves the owning-organization fence
            // without exposing Project persistence to this transport.
            const organizationId = await ctx.app.gateway.tryGetProjectOrganization(input.projectId);
            const vks =
              vkIds.length && organizationId
                ? await ctx.app.gateway.resolveVirtualKeyNames({
                    organizationId,
                    virtualKeyIds: vkIds,
                  })
                : [];
            const virtualKeyNames = Object.fromEntries(vks.map((vk) => [vk.id, vk.name]));

            // The wire still carries a Date on this row, so the instant the
            // ledger reads becomes one here rather than anywhere above.
            return {
              rows: rows.map((row) => ({ ...row, occurredAt: toDate(row.occurredAt) })),
              nextCursor,
              virtualKeyNames,
              clickHouseDisabled: false,
            };
          }),
      )
      .build();
  }
}
