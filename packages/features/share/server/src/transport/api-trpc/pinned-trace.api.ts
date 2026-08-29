/**
 * Trace pinning over the process's tRPC transport.
 *
 * A pin exempts one trace from the project's retention sweep, so the pin
 * itself is retention state and lives on `DataRetentionService`. Unpinning is
 * the one operation share owns: an active share link holds its trace pinned,
 * and dropping that pin out from under a live link would break the link, so
 * `ShareService.unpinTrace` is the guard that refuses it.
 *
 * Transport only: gates, input parsing and delegation.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { PinnedToActiveShareError, type ShareService } from "@langwatch/share-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type PinnedTraceApplication = Readonly<{
  share: ShareService;
  dataRetention: DataRetentionService;
}>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type PinnedTraceTrpcContext = Readonly<{
  app: PinnedTraceApplication;
  actor(): Readonly<{ id: string }>;
}>;

type PinnedTraceTrpcProcedures<
  TContext extends PinnedTraceTrpcContext,
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

const traceScopeSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
});

const pinInputSchema = traceScopeSchema.extend({
  reason: z.string().optional(),
});

const projectScopeSchema = z.object({ projectId: z.string() });

/** Installs the complete `pinnedTrace.*` tRPC surface on a process-owned root. */
export class PinnedTraceTrpcApi {
  static create<
    TContext extends PinnedTraceTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PinnedTraceTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      pin: policy("project:update")(procedure.input(pinInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.dataRetention.pin({
            projectId: input.projectId,
            traceId: input.traceId,
            userId: ctx.actor().id,
            reason: input.reason,
          });
        },
      ),

      unpin: policy("project:update")(procedure.input(traceScopeSchema)).mutation(
        async ({ ctx, input }) => {
          try {
            await ctx.app.share.unpinTrace({
              projectId: input.projectId,
              traceId: input.traceId,
            });
          } catch (error) {
            // Surfaces as a non-toast inline error in the UI (the PinButton also
            // disables itself when source=share + share active, but we never
            // trust the client; the route is the authoritative gate).
            if (error instanceof PinnedToActiveShareError) {
              throw new TRPCError({ code: "CONFLICT", message: error.message });
            }
            throw error;
          }
        },
      ),

      getPin: policy("traces:view")(procedure.input(traceScopeSchema)).query(
        async ({ ctx, input }) => {
          return ctx.app.dataRetention.tryGetPin({
            projectId: input.projectId,
            traceId: input.traceId,
          });
        },
      ),

      listByProject: policy("traces:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => {
          return ctx.app.dataRetention.listByProject({
            projectId: input.projectId,
          });
        },
      ),
    });
  }
}
