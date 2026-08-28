/**
 * LangWatchQL analytics SQL — the session-authenticated surface the workbench
 * calls, over a host's tRPC transport.
 *
 *   availability: whether the query path is switched on AND provisioned, and
 *                 which of the two is missing when it is not.
 *   schema:       the datasets and columns this member's permissions unlock.
 *   query:        one submitted statement, run exactly as written.
 *
 * The REST endpoints under the host's `analytics-sql` routes serve API keys;
 * this serves a signed-in member looking at the Custom query page. Same
 * service, same policy, different credential — so the only thing that differs
 * is where *who is asking* comes from, which is why the caller resolution is a
 * port rather than a decision made here.
 *
 * ## Nothing here validates SQL
 *
 * The Zod input describes the request SHAPE and stops there. Parsing, the
 * default-deny policy, tenant isolation and the resource ceilings all live in
 * the service, and a second opinion at this layer could only ever disagree with
 * it — refusing something the service would allow, or worse, allowing something
 * it would refuse and teaching a caller the wrong rule.
 *
 * Handled errors propagate untouched: the host's tRPC boundary already
 * serialises a `HandledError` into a code plus its `meta`, and the workbench
 * renders registry copy keyed by that code. Catching and rewrapping here would
 * replace a refusal the member can act on with one they cannot.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  langWatchQLQueryResultSchema,
  langWatchQLSchema,
  type LangWatchQLCaller,
  type LangWatchQLProtections,
  type LangWatchQLService,
  type LangWatchQLTimeWindow,
} from "@langwatch/analytics-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type LangWatchQLApplication = Readonly<{ langWatchQL: LangWatchQLService }>;

/** The host supplies authentication; authorization arrives as `policy`. */
export type LangWatchQLTrpcContext = Readonly<{ app: LangWatchQLApplication }>;

type LangWatchQLTrpcProcedures<
  TContext extends LangWatchQLTrpcContext,
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
 * Which gate closed, when one did.
 *
 * `disabled` is the project's own switch being off, which its administrator can
 * change; `unprovisioned` is a deployment with no LangWatchQL identity to run
 * as, which they cannot. They read as different refusals, so the page has to be
 * able to tell them apart.
 */
export type LangWatchQLUnavailableReason = "disabled" | "unprovisioned";

export interface LangWatchQLAvailability {
  /** What the navigation entry and the page gate on. */
  readonly available: boolean;
  /** Absent when available. */
  readonly reason?: LangWatchQLUnavailableReason;
}

/**
 * The host capabilities this transport needs that are not Analytics' own.
 */
export type LangWatchQLTrpcPorts = Readonly<{
  /**
   * The workbench's experimental switch, chained AFTER the permission check so
   * a caller is placed by RBAC first and gated by the rollout second: a member
   * who may not touch the project should not learn from the answer whether the
   * experiment is switched on for it.
   */
  requireWorkbenchEnabled<TProcedure>(procedure: TProcedure): TProcedure;
  /**
   * The same decision, read rather than enforced. `availability` is the one
   * procedure whose whole job is to answer "off" out loud, so the gate above —
   * which every other procedure here chains — would refuse the very question
   * being asked.
   */
  isWorkbenchEnabled(
    ctx: LangWatchQLTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<boolean>;
  /** The longest statement this deployment accepts. */
  maxStatementLength: number;
  /** The period a caller reports over, as every door accepts it. */
  timeWindowSchema: z.ZodType<LangWatchQLTimeWindow>;
  /**
   * The datapoint steps this deployment offers, so an off-list value is a
   * schema rejection here rather than reaching the service's backstop. The
   * bucket-budget arithmetic and its refusal are still the service's.
   */
  granularityStepSchema: z.ZodType<number>;
  /** The member's own content protections for this project. */
  resolveProtections(
    ctx: LangWatchQLTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<LangWatchQLProtections>;
  /**
   * The project identity and protections an execution runs under. The
   * project's LangWatchQL secret is hashed into the tenant capability the query
   * runs as: it is read server-side and must never leave the calling procedure
   * — no field of it may appear in a response.
   */
  resolveRunCaller(
    ctx: LangWatchQLTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
}>;

/**
 * A bound parameter's value. Scalars only — a parameter is a *value*, and
 * anything structured would be one whose shape a ClickHouse type cannot
 * describe.
 */
const parameterValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const projectScopeSchema = z.object({ projectId: z.string() });

/**
 * Installs the complete LangWatchQL tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class LangWatchQLTrpcApi {
  static create<
    TContext extends LangWatchQLTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LangWatchQLTrpcProcedures<TContext, TOptions, TRoot>,
    ports: LangWatchQLTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;
    const { requireWorkbenchEnabled } = ports;

    return trpc.router({
      /**
       * Separate from `schema` because the schema is answerable without an
       * executor (it is the catalog), so a deployment with no LangWatchQL
       * identity would describe a surface it cannot run. The navigation gates
       * on this, never on the schema.
       *
       * One object with an optional reason rather than a union, so a consumer
       * that only cares whether the surface is on keeps reading `available` and
       * nothing else.
       */
      availability: policy("analytics:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }): Promise<LangWatchQLAvailability> => {
          const enabled = await ports.isWorkbenchEnabled(ctx, {
            projectId: input.projectId,
          });
          if (!enabled) return { available: false, reason: "disabled" };

          if (!ctx.app.langWatchQL.available) {
            return { available: false, reason: "unprovisioned" };
          }
          return { available: true };
        },
      ),

      /** The datasets and columns this member's permissions unlock. */
      schema: requireWorkbenchEnabled(
        policy("analytics:view")(procedure.input(projectScopeSchema)),
      )
        .output(langWatchQLSchema)
        .query(async ({ ctx, input }) =>
          ctx.app.langWatchQL.describeSchema({
            protections: await ports.resolveProtections(ctx, { projectId: input.projectId }),
          }),
        ),

      query: requireWorkbenchEnabled(
        policy("analytics:view")(
          procedure.input(
            projectScopeSchema.extend({
              // Deliberately not `.trim()`: the statement the database runs
              // must be the one that was submitted.
              sql: z.string().min(1).max(ports.maxStatementLength),
              parameters: z.record(z.string(), parameterValueSchema).optional(),
              timeWindow: ports.timeWindowSchema.optional(),
              /**
               * The datapoint step for a statement that declares
               * `{period_granularity_seconds:UInt32}`, in seconds.
               */
              granularitySeconds: ports.granularityStepSchema.optional(),
            }),
          ),
        ),
      )
        .output(langWatchQLQueryResultSchema)
        .mutation(async ({ ctx, input }) => {
          const { project, protections } = await ports.resolveRunCaller(ctx, {
            projectId: input.projectId,
          });

          return ctx.app.langWatchQL.execute({
            project,
            protections,
            sql: input.sql,
            ...(input.parameters ? { parameters: input.parameters } : {}),
            ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
            ...(input.granularitySeconds === undefined
              ? {}
              : { granularitySeconds: input.granularitySeconds }),
          });
        }),
    });
  }
}
