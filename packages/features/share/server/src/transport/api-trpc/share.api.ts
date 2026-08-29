/**
 * Share-link management over the process's tRPC transport.
 *
 * Anonymous reads DO NOT live here — they go through the dedicated
 * `sharedTrace.get` surface, which is the single public trace read ADR-057
 * allows. This transport only mints, lists and revokes links; the domain
 * guards (sharing kill switch, thread derivation, allowlist) live in
 * `ShareService` and surface as HandledErrors.
 *
 * Transport only: gates, input parsing and delegation to `ShareService`.
 *
 * Spec: ADR-057.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  shareResourceTypeSchema,
  shareVisibilitySchema,
  type ShareService,
} from "@langwatch/share-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

type ShareApplication = Readonly<{ share: ShareService }>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type ShareTrpcContext = Readonly<{
  app: ShareApplication;
  actor(): Readonly<{ id: string }>;
}>;

type ShareTrpcProcedures<
  TContext extends ShareTrpcContext,
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

const listForResourceInputSchema = z.object({
  projectId: z.string(),
  resourceType: shareResourceTypeSchema,
  resourceId: z.string(),
});

/**
 * TRACE only: `sharedTrace.get` can render a trace and nothing else, so
 * accepting THREAD here would mint a capability no viewer can redeem. Thread
 * sharing is parked until the aggregate can carry the surrounding
 * conversation — see ADR-057's follow-ups.
 */
const createShareInputSchema = z.object({
  projectId: z.string(),
  resourceType: z.literal("TRACE"),
  resourceId: z.string(),
  visibility: shareVisibilitySchema.default("PUBLIC"),
  expiresAt: z.date().nullish(),
  maxViews: z.number().int().positive().nullish(),
});

const revokeInputSchema = z.object({ projectId: z.string(), id: z.string() });

const projectScopeSchema = z.object({ projectId: z.string() });

/** Installs the complete `share.*` tRPC surface on a process-owned root. */
export class ShareTrpcApi {
  static create<
    TContext extends ShareTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ShareTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * All links for a resource — backs the management list in the share
       * drawer. Requires `traces:share` (not `traces:view`): the list
       * re-displays the secret tokens, so only someone who can mint/revoke
       * shares may enumerate them.
       */
      listForResource: policy("traces:share")(procedure.input(listForResourceInputSchema)).query(
        async ({ ctx, input }) => {
          return ctx.app.share.listForResource(input);
        },
      ),

      /** Mint a share link. */
      createShare: policy("traces:share")(procedure.input(createShareInputSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.share.createShare({
            projectId: input.projectId,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            visibility: input.visibility,
            expiresAt: input.expiresAt ?? null,
            maxViews: input.maxViews ?? null,
            userId: ctx.actor().id,
          });
        },
      ),

      /** Revoke a single link by id. */
      revoke: policy("traces:share")(procedure.input(revokeInputSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.share.revokeById(input);
        },
      ),

      revokeAllTraceShares: policy("project:update")(procedure.input(projectScopeSchema)).mutation(
        async ({ ctx, input }) => {
          await ctx.app.share.revokeAllTraceShares(input.projectId);
        },
      ),
    });
  }
}
