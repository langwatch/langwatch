/**
 * Stored-object existence probes over the process's tRPC transport.
 *
 * Server-side probes so the renderer does not have to issue raw `fetch` calls
 * to `/api/files/:id`: auth is inherited from the tRPC session, which avoids
 * the CORS / credential fragility of a native HEAD probe.
 *
 * Transport only: gates, input parsing and delegation.
 */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { storedObjectHeadSchema } from "@langwatch/stored-object-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { StoredObjectApp } from "#app/stored-object.app";

/**
 * The process supplies authentication; authorization arrives as `policyAny`.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type StoredObjectTrpcContext = Readonly<{
  app: Readonly<{ storedObjectApp: StoredObjectApp }>;
}>;

type StoredObjectTrpcProcedures<
  TContext extends StoredObjectTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for a set of permissions any one of which suffices. List the
   * primary surface's permission first — the denial names it.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policyAny(...permissions: readonly [AuthzPermission, ...AuthzPermission[]]): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

const headByIdInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
});

/** Installs the complete `storedObjects.*` tRPC surface on a process-owned root. */
export class StoredObjectTrpcApi {
  static create<
    TContext extends StoredObjectTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: StoredObjectTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policyAny } = procedures;

    return (
      createTrpcService({
        root: trpc,
        procedures: {
          protected: procedure,
          // Every procedure here declares its access through `withCustomPermission`
          // with this feature's own `policyAny`, so the chain's own single-
          // permission entry point is never reached.
          policy: () => (p) => p,
        },
        validateOutput: procedures.validateOutput,
      })
        /**
         * Probes whether a stored object's row AND bytes exist.
         *
         * The renderer maps `missing` to the placeholder badge (feature
         * requirement) and `not_found` to a generic error.
         *
         * Auth: `traces:view` OR `scenarios:view` on `projectId`, mirroring the
         * `/api/files/:id` route's own gate. The same stored object is trace
         * media for one viewer and scenario media for another, and the two
         * permissions are separate categories a custom role can hold one of. A
         * probe narrower than the read it describes leaves a viewer who can
         * fetch the bytes unable to find out why the player failed, which
         * strands the renderer in its loading state.
         */
        .query("headById", (p) =>
          p
            .withInput(headByIdInputSchema)
            .withOutput(storedObjectHeadSchema)
            .withCustomPermission(
              policyAny("traces:view", "scenarios:view"),
              "either permission suffices: one stored object is trace media for one viewer and scenario media for another",
            )
            .handle(async ({ ctx, input }) => {
              const { projectId, id } = input;
              return ctx.app.storedObjectApp.headById({ projectId, id });
            }),
        )
        .build()
    );
  }
}
