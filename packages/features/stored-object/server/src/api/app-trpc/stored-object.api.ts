/**
 * Stored-object existence probes over the process's tRPC transport.
 *
 * Server-side probes so the renderer does not have to issue raw `fetch` calls
 * to `/api/files/:id`: auth is inherited from the tRPC session, which avoids
 * the CORS / credential fragility of a native HEAD probe.
 *
 * Transport only: gates, input parsing and delegation.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/**
 * The tri-state the probe answers with, matching the `/api/files/:id` HTTP
 * route:
 *  - `available` — row exists and storage has the bytes
 *  - `missing`   — row exists but the blob is gone (compensating delete
 *                  crashed, retention sweep, and so on)
 *  - `not_found` — no row matches
 */
export type StoredObjectHead =
  | { status: "available"; mediaType: string }
  | { status: "missing"; mediaType: string }
  | { status: "not_found" };

/**
 * The probe capability this transport needs.
 *
 * Deliberately narrower than `StoredObjectService`: the probe is the only
 * thing this surface may reach, and the process still supplies the complete
 * stored-objects capability behind it.
 */
export type StoredObjectProbe = Readonly<{
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead>;
}>;

type StoredObjectApplication = Readonly<{ storedObjects: StoredObjectProbe }>;

/** The process supplies authentication; authorization arrives as `policyAny`. */
export type StoredObjectTrpcContext = Readonly<{ app: StoredObjectApplication }>;

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
  policyAny(
    ...permissions: readonly [AuthzPermission, ...AuthzPermission[]]
  ): <TProcedure>(procedure: TProcedure) => TProcedure;
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

    return trpc.router({
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
      headById: policyAny(
        "traces:view",
        "scenarios:view",
      )(procedure.input(headByIdInputSchema)).query(async ({ ctx, input }) => {
        const { projectId, id } = input;
        return ctx.app.storedObjects.headById({ projectId, id });
      }),
    });
  }
}
