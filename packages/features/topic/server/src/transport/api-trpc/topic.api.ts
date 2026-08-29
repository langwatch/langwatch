/**
 * The project's conversation topics over the process's tRPC transport.
 *
 *   getAll:                  every topic and subtopic the project has, which
 *                            the trace filters, the topic counts and the
 *                            topics settings page all read.
 *   getClusteringStatus:     whether a clustering run is in flight, and what
 *                            the last one produced.
 *   getClusteringRunHistory: the recent runs, for the settings page's log.
 *
 * Reading topics reads captured conversation content indirectly — a topic name
 * is derived from the messages it was clustered from — so `getAll` asks for
 * `traces:view`. The two clustering reads describe the *run* rather than its
 * content and stay at `project:view`, which is what they asked for before this
 * surface moved.
 *
 * Transport only: gates and delegation to `TopicService`.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { TopicService } from "@langwatch/topic-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

type TopicApplication = Readonly<{ topics: TopicService }>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type TopicTrpcContext = Readonly<{ app: TopicApplication }>;

type TopicTrpcProcedures<
  TContext extends TopicTrpcContext,
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

const projectScopeSchema = z.object({ projectId: z.string() });

/**
 * Installs the complete `topics.*` tRPC surface on a process-owned root. The
 * procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class TopicTrpcApi {
  static create<
    TContext extends TopicTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: TopicTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      getAll: policy("traces:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) => await ctx.app.topics.getAll({ projectId: input.projectId }),
      ),

      getClusteringStatus: policy("project:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) =>
          await ctx.app.topics.getClusteringStatus({ projectId: input.projectId }),
      ),

      getClusteringRunHistory: policy("project:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) =>
          await ctx.app.topics.getClusteringRunHistory({ projectId: input.projectId }),
      ),
    });
  }
}
