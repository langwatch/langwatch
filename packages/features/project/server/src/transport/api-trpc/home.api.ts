/**
 * A project's home page over the process's tRPC transport.
 *
 * One procedure: the recent-items strip. Its input is a project id, its gate
 * is `project:view`, and its answer is "what has happened in this project" —
 * which is why the project feature owns it rather than a feature of its own.
 * The entities it names (prompts, workflows, datasets, evaluations,
 * annotations, simulations) arrive already hydrated, so this transport does
 * not depend on any of those features.
 *
 * Onboarding status is NOT here: it is `integrationsChecks.getCheckStatus`.
 *
 * Transport only: the gate, the input parser and delegation to the process's
 * recent-items reader, which walks the audit trail and hydrates each entity.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import {
  ProjectCallerUnauthenticatedError,
  recentItemSchema,
  type RecentItem,
} from "@langwatch/project-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/** The process supplies authentication; authorization arrives as `policy`. */
export type HomeTrpcContext = Readonly<{
  session: Readonly<{ user: Readonly<{ id: string }> }> | null;
}>;

type HomeTrpcProcedures<
  TContext extends HomeTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration. The chain applies it AFTER this
   * feature's input parser, which is the ordering the authorization check
   * depends on: a check installed before `.input()` reads no scope id.
   */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** The process capability this transport needs that is not the project's own. */
export type HomeTrpcPorts = Readonly<{
  /**
   * The entities this user most recently touched in this project, newest
   * first and already hydrated with the name and link the strip renders.
   */
  getRecentItems(
    ctx: HomeTrpcContext,
    input: Readonly<{ userId: string; projectId: string; limit: number }>,
  ): Promise<RecentItem[]>;
}>;

const getRecentItemsInputSchema = z.object({
  projectId: z.string(),
  limit: z.number().min(1).max(50).default(12),
});

/** Installs the complete `home.*` tRPC surface on a process-owned root. */
export class HomeTrpcApi {
  static create<
    TContext extends HomeTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: HomeTrpcProcedures<TContext, TOptions, TRoot>,
    ports: HomeTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput: procedures.validateOutput,
    })
      .query("getRecentItems", (p) =>
        p
          .withInput(getRecentItemsInputSchema)
          .withOutput(recentItemSchema.array())
          .withPermission("project:view")
          .handle(async ({ ctx, input }) => {
            const user = ctx.session?.user;
            // `protectedProcedure` has already refused an anonymous caller;
            // this only narrows the type. A blank user id here would widen the
            // read to somebody else's trail rather than refusing it.
            if (!user) throw new ProjectCallerUnauthenticatedError();
            return ports.getRecentItems(ctx, {
              userId: user.id,
              projectId: input.projectId,
              limit: input.limit,
            });
          }),
      )
      .build();
  }
}
