/**
 * The project's analytics reads over a host's tRPC transport.
 *
 *   getTimeseries:     the series behind every chart on the analytics pages and
 *                      every graph card on a dashboard.
 *   dataForFilter:     the values a filter can offer for one field, narrowed by
 *                      the other filters already applied.
 *   topUsedDocuments:  the retrieval documents a project's traces cite most.
 *   feedbacks:         the thumbs and comments left on the project's messages.
 *
 * Reading a series takes `analytics:view`; the two cost-oriented reads take
 * `cost:view`, which is what they took before the transport moved.
 *
 * Transport only: policy and delegation to `AnalyticsService`. Nothing here
 * decides what a series means — the metric registry, the filter catalogue and
 * the query routing are the host's and the service's respectively.
 *
 * Spec: packages/features/analytics/specs/analytics-timeseries.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type {
  AnalyticsReadInput,
  AnalyticsTimeseriesInput,
} from "@langwatch/analytics-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { AnalyticsApp } from "#app/analytics.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the host's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them.
 */
export type AnalyticsTrpcContext = Readonly<{
  app: Readonly<{ analytics: AnalyticsApp }>;
}>;

type AnalyticsTrpcProcedures<
  TContext extends AnalyticsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The host capabilities this transport needs that are not Analytics' own.
 *
 * Both schemas are injected rather than declared here because the same two
 * shapes are the REST analytics body and the traces filter input: one
 * definition, in the host, is what keeps those three surfaces from drifting
 * while the analytics input vertical is still application-owned.
 */
export type AnalyticsTrpcPorts<
  TTimeseriesInput extends AnalyticsTimeseriesInput,
  TReadInput extends AnalyticsReadInput,
  TFilterField extends string,
> = Readonly<{
  /** The full timeseries request: shared filters plus the series to compute. */
  timeseriesInputSchema: z.ZodType<TTimeseriesInput>;
  /** Project, period, query and filters — everything a read is scoped by. */
  sharedFiltersSchema: z.ZodType<TReadInput>;
  /** The filter fields this deployment offers. */
  filterFieldSchema: z.ZodType<TFilterField>;
  /** Whether a field is meaningless without a key, or without a subkey. */
  filterFieldRequiresKey(field: TFilterField): boolean;
  filterFieldRequiresSubkey(field: TFilterField): boolean;
}>;

/**
 * Installs the complete `analytics.*` read surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 *
 * The LangWatchQL and saved-chart sub-routers are mounted alongside these by
 * the host, because both still reach for application-owned collaborators.
 */
export class AnalyticsTrpcApi {
  static create<
    TContext extends AnalyticsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TTimeseriesInput extends AnalyticsTimeseriesInput,
    TReadInput extends AnalyticsReadInput,
    TFilterField extends string,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AnalyticsTrpcProcedures<TContext, TOptions, TRoot>,
    ports: AnalyticsTrpcPorts<TTimeseriesInput, TReadInput, TFilterField>,
  ) {
    const { protected: procedure, policy } = procedures;

    /**
     * The narrowing this read adds on top of the host's shared filters.
     *
     * Chained onto `sharedFiltersSchema` with a SECOND `.input()` rather than
     * intersected into one parser: tRPC keeps every input parser, runs each
     * against the raw request and spreads the results, so the handler sees the
     * same object either way — but a `ZodIntersection` exposes no `.shape`, so
     * the declaration sweep cannot read `projectId` out of it and reports the
     * procedure as opaque input with no scope id to check. Two readable object
     * parsers keep the authorization declaration verifiable.
     */
    const filterSelectionSchema = z.object({
      field: ports.filterFieldSchema,
      key: z.string().optional(),
      subkey: z.string().optional(),
      query: z.string().optional(),
    });

    return trpc.router({
      getTimeseries: policy("analytics:view")(procedure.input(ports.timeseriesInputSchema)).query(
        async ({ ctx, input }) => ctx.app.analytics.getTimeseries(input),
      ),

      dataForFilter: policy("analytics:view")(
        procedure.input(ports.sharedFiltersSchema).input(filterSelectionSchema),
      ).query(async ({ ctx, input }) => {
        const { field, key, subkey } = input;

        if (ports.filterFieldRequiresKey(field) && !key) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Field ${field} requires a key to be defined`,
          });
        }

        if (ports.filterFieldRequiresSubkey(field) && !subkey) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Field ${field} requires a subkey to be defined`,
          });
        }

        // The narrowing rule — a field's own selection must not narrow the
        // values offered for it — belongs to the application, so both doors
        // ask the same question rather than each remembering to exclude it.
        const options = await ctx.app.analytics.filterOptions({
          projectId: input.projectId,
          field,
          query: input.query,
          key,
          subkey,
          startDate: input.startDate,
          endDate: input.endDate,
          filters: input.filters,
        });

        return { options };
      }),

      // The full shared-filter schema is accepted for API compatibility even
      // though only projectId, startDate, endDate and filters are read; query,
      // traceIds and negateFilters are accepted and ignored.
      topUsedDocuments: policy("cost:view")(procedure.input(ports.sharedFiltersSchema)).query(
        async ({ ctx, input }) => ctx.app.analytics.getTopUsedDocuments(input),
      ),

      feedbacks: policy("cost:view")(procedure.input(ports.sharedFiltersSchema)).query(
        async ({ ctx, input }) => ctx.app.analytics.getFeedbacks(input),
      ),
    });
  }
}
