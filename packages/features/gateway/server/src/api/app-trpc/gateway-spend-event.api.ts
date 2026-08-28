/**
 * The gateway spend-event ledger over the process's tRPC transport.
 *
 * A read-only, newest-first, cursor-paged view over `gateway_spend`, the
 * per-request billing record the gateway_spend pipeline writes unconditionally.
 * Project-scoped, like the neighbouring usage reads; organization-wide rollups
 * are a later fast-follow.
 *
 * Transport only: input parsing, the ClickHouse-absent degrade, and delegation.
 * Resolving virtual-key display names is a persistence read this transport does
 * not own, so it arrives as a port.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { spendFiltersSchema } from "../../adapters/gateway-spend-filters.adapter";
import type { GatewaySpendEventsService } from "../../services/gateway-spend-events.service";

type GatewaySpendEventApplication = Readonly<{
  gateway: Readonly<{ spendEvents: GatewaySpendEventsService | undefined }>;
  projects: Pick<ProjectService, "tryGetOrganizationId">;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type GatewaySpendEventTrpcContext = Readonly<{
  app: GatewaySpendEventApplication;
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
  /**
   * Tracing, logging, error shaping, scope lineage, the check, and audit,
   * applied AFTER this feature's input parser: tRPC runs middlewares in the
   * order they were added, and the check reads its scope id from the validated
   * input.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

export type GatewaySpendEventTrpcPorts = Readonly<{
  /**
   * Display names for the keys a page of spend rows names.
   *
   * VirtualKey is organization-scoped post-collapse (no projectId column), so
   * the lookup is fenced by the owning organization the caller's project
   * resolves to — never by the raw ids off the rows alone.
   */
  resolveVirtualKeyNames(input: {
    organizationId: string;
    virtualKeyIds: readonly string[];
  }): Promise<ReadonlyArray<{ id: string; name: string }>>;
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
    TPorts extends GatewaySpendEventTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GatewaySpendEventTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      list: policy("gatewayUsage:view")(procedure.input(listInputSchema)).query(
        async ({ ctx, input }) => {
          const service = ctx.app.gateway.spendEvents;
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
          const organizationId = await ctx.app.projects.tryGetOrganizationId(input.projectId);
          const vks =
            vkIds.length && organizationId
              ? await ports.resolveVirtualKeyNames({ organizationId, virtualKeyIds: vkIds })
              : [];
          const virtualKeyNames = Object.fromEntries(vks.map((vk) => [vk.id, vk.name]));

          return { rows, nextCursor, virtualKeyNames, clickHouseDisabled: false };
        },
      ),
    });
  }
}
