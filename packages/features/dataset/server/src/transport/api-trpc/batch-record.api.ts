/**
 * A project's batch-evaluation records over a host's tRPC transport.
 *
 *   getAllByexperimentIdGroup: one row per experiment and dataset — how many
 *                              batch evaluations ran, what they cost, and the
 *                              mean score. The batch-evaluations index renders
 *                              this.
 *   getAllByexperimentSlug:    every batch-evaluation record of one experiment,
 *                              with the dataset each ran against.
 *
 * Both take `workflows:view`: a batch evaluation is a workflow run, and this is
 * the run history of one.
 *
 * Transport only. The two record reads are host ports rather than application
 * operations, because `BatchEvaluation` is not Dataset-owned state — it is the
 * remaining seam this transport sits on, and the ports keep its persistence in
 * the host until it has a feature of its own. The slug-to-id read IS the
 * application's, and goes through it.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { DatasetApp } from "#app/dataset.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * The slug-to-id read this transport makes is on {@link DatasetApp} rather
 * than on a second slice of the host bag: one application per feature is what
 * lets a door reach everything the feature needs without knowing how the host
 * happens to have arranged the rest of itself.
 */
export type BatchRecordTrpcContext = Readonly<{ app: Readonly<{ dataset: DatasetApp }> }>;

type BatchRecordTrpcProcedures<
  TContext extends BatchRecordTrpcContext,
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
 * The two batch-evaluation reads, owned by the host that owns the table. Their
 * result types stay generic so the wire shape the browser already types against
 * is the host's own, not a hand-copied restatement of it that could drift.
 *
 * Each method is handed the request context so the host reads through exactly
 * the client the request already carries.
 */
export type BatchRecordTrpcPorts<TSummaries, TRecords> = Readonly<{
  /** Per experiment and dataset: how many ran, total cost, mean score. */
  summariseByExperiment(
    ctx: BatchRecordTrpcContext,
    input: Readonly<{ projectId: string }>,
  ): Promise<TSummaries>;
  /** Every record of one experiment, with the dataset each ran against. */
  listByExperiment(
    ctx: BatchRecordTrpcContext,
    input: Readonly<{ projectId: string; experimentId: string }>,
  ): Promise<TRecords>;
}>;

const projectScopeSchema = z.object({ projectId: z.string() });

const experimentSlugInputSchema = z.object({
  projectId: z.string(),
  experimentSlug: z.string(),
});

/**
 * Installs the complete `batchRecord.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class BatchRecordTrpcApi {
  static create<
    TContext extends BatchRecordTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TSummaries,
    TRecords,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: BatchRecordTrpcProcedures<TContext, TOptions, TRoot>,
    ports: BatchRecordTrpcPorts<TSummaries, TRecords>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getAllByexperimentIdGroup: policy("workflows:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ input, ctx }) => {
        const { projectId } = input;

        return await ports.summariseByExperiment(ctx, { projectId });
      }),

      getAllByexperimentSlug: policy("workflows:view")(
        procedure.input(experimentSlugInputSchema),
      ).query(async ({ input, ctx }) => {
        const { projectId, experimentSlug } = input;

        const experiment = await ctx.app.dataset.tryGetExperimentBySlug({
          projectId,
          slug: experimentSlug,
        });

        if (!experiment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Experiment not found",
          });
        }

        return await ports.listByExperiment(ctx, {
          projectId,
          experimentId: experiment.id,
        });
      }),
    });
  }
}
