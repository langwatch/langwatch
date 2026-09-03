/**
 * The traces page's saved views over a host's tRPC transport.
 *
 *   getAll:  the project's shared views plus the caller's own personal ones,
 *            seeded with the origin defaults on first access.
 *   create:  a new view, shared with the project or personal to the caller.
 *   delete:  one view; a personal view only for the member who owns it.
 *   rename:  one view, under the same ownership rule.
 *   reorder: the order the tab strip lists them in.
 *
 * Every procedure takes `traces:view`: a saved view is a stored trace filter,
 * so being able to read traces is exactly the right to keep one.
 *
 * Transport only: policy and delegation. The view lifecycle — seeding,
 * back-filling, ordering and the personal-ownership rule — is the service's,
 * which the host injects because it still lives in the application while the
 * saved-view vertical is drained.
 *
 * Spec: packages/features/dashboard/specs/saved-views.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { SavedViewNotFoundError, SavedViewReorderError } from "@langwatch/dashboard-contract";
import { HandledError } from "@langwatch/handled-error";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/** A saved view the project — or the caller — does not have. */
export class SavedViewNotThereError extends HandledError {
  declare readonly code: "saved_view_not_found";

  constructor(message: string) {
    super("saved_view_not_found", message, { httpStatus: 404 });
    this.name = "SavedViewNotThereError";
  }
}

/** A reorder naming saved views that are not there. */
export class SavedViewReorderUnknownIdsError extends HandledError {
  declare readonly code: "saved_view_reorder_unknown_ids";

  constructor(missingIds: readonly string[]) {
    super("saved_view_reorder_unknown_ids", `Saved views not found: ${missingIds.join(", ")}`, {
      httpStatus: 404,
      meta: { ids: [...missingIds] },
    });
    this.name = "SavedViewReorderUnknownIdsError";
  }
}

/** The host supplies authentication; authorization arrives as `policy`. */
export type SavedViewTrpcContext = Readonly<{ actor(): Readonly<{ id: string }> }>;

type SavedViewTrpcProcedures<
  TContext extends SavedViewTrpcContext,
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

/** The stored period a view remembers, exactly as the filter bar writes it. */
export type SavedViewPeriod = Readonly<{
  relativeDays?: number;
  startDate?: string;
  endDate?: string;
}>;

/**
 * The saved-view lifecycle this transport delegates to.
 *
 * `TView` is inferred from the host's own service so the rows reach the client
 * with the shape they have always had, rather than a narrowed copy of it.
 */
export type SavedViewsPort<TView> = Readonly<{
  getAll(input: Readonly<{ projectId: string; userId?: string; kind?: string }>): Promise<TView[]>;
  create(
    input: Readonly<{
      projectId: string;
      id?: string;
      name: string;
      filters: Record<string, unknown>;
      query?: string;
      period?: SavedViewPeriod;
      /** Present for a personal view, absent for one shared with the project. */
      userId?: string;
      kind?: string;
    }>,
  ): Promise<TView>;
  delete(input: Readonly<{ projectId: string; viewId: string; userId: string }>): Promise<TView>;
  rename(
    input: Readonly<{ projectId: string; viewId: string; name: string; userId: string }>,
  ): Promise<TView>;
  reorder(input: Readonly<{ projectId: string; viewIds: string[] }>): Promise<{ success: true }>;
}>;

export type SavedViewTrpcPorts<TView> = Readonly<{ savedViews: SavedViewsPort<TView> }>;

/**
 * Names the two saved-view absences on the typed channel, and hands everything
 * else back untouched.
 *
 * Both were the `NOT_FOUND` this surface has always answered with, built by
 * hand as a `TRPCError`. They are `HandledError`s now, each with its own
 * stable code, so the client renders copy for the one that happened rather
 * than for "not found" in general. Anything else is re-raised exactly as it
 * arrived and degrades to "unknown" plus a trace id at the boundary, which is
 * correct for a failure we cannot name.
 *
 * The lifecycle these come from is still the host's — it arrives as
 * `ports.savedViews`, generic in the row shape the client sees — so this
 * translation stays here rather than moving onto the application with the rest
 * of the feature's refusals.
 */
function mapSavedViewError(error: unknown): never {
  if (error instanceof SavedViewNotFoundError) {
    throw new SavedViewNotThereError(error.message);
  }
  if (error instanceof SavedViewReorderError) {
    throw new SavedViewReorderUnknownIdsError(error.missingIds);
  }
  throw error;
}

async function savedViewCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    mapSavedViewError(error);
  }
}

const projectScopeSchema = z.object({
  projectId: z.string(),
  // Storage shape to read. Omit for the legacy default ("v1-traces-filter") so
  // existing callers keep working; traces v2 passes "v2-traces-lens" to scope
  // to its own rows.
  kind: z.string().optional(),
});

const nameSchema = z.string().min(1).max(255);

/**
 * Installs the complete `savedViews.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class SavedViewTrpcApi {
  static create<
    TContext extends SavedViewTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TView,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SavedViewTrpcProcedures<TContext, TOptions, TRoot>,
    ports: SavedViewTrpcPorts<TView>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /** Auto-seeds the origin defaults the first time a project asks. */
      getAll: policy("traces:view")(procedure.input(projectScopeSchema)).query(
        async ({ ctx, input }) =>
          await savedViewCall(() =>
            ports.savedViews.getAll({
              projectId: input.projectId,
              userId: ctx.actor().id,
              ...(input.kind === undefined ? {} : { kind: input.kind }),
            }),
          ),
      ),

      /**
       * A `myself` view is visible only to its creator; a `project` view — the
       * default — is shared with everyone on the team.
       */
      create: policy("traces:view")(
        procedure.input(
          projectScopeSchema.extend({
            name: nameSchema,
            filters: z.record(z.string(), z.unknown()),
            query: z.string().optional(),
            period: z
              .object({
                relativeDays: z.number().optional(),
                startDate: z.string().optional(),
                endDate: z.string().optional(),
              })
              .optional(),
            scope: z.enum(["project", "myself"]).default("project"),
            // Optional client-provided id. Traces v2 generates lens ids locally
            // so the in-store active id keeps pointing at the same row after the
            // server roundtrip completes — otherwise the active lens would be
            // invalidated by the refetch (server id != client id) and the tab
            // strip would snap back to the first built-in. Accepts strings that
            // look like client-side lens ids (`custom-...`). The service still
            // generates one if omitted.
            id: z.string().min(1).max(128).optional(),
          }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          await savedViewCall(() =>
            ports.savedViews.create({
              projectId: input.projectId,
              ...(input.id === undefined ? {} : { id: input.id }),
              name: input.name,
              filters: input.filters,
              ...(input.query === undefined ? {} : { query: input.query }),
              ...(input.period === undefined ? {} : { period: input.period }),
              ...(input.scope === "myself" ? { userId: ctx.actor().id } : {}),
              ...(input.kind === undefined ? {} : { kind: input.kind }),
            }),
          ),
      ),

      delete: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string(), viewId: z.string() })),
      ).mutation(
        async ({ ctx, input }) =>
          await savedViewCall(() =>
            ports.savedViews.delete({
              projectId: input.projectId,
              viewId: input.viewId,
              userId: ctx.actor().id,
            }),
          ),
      ),

      rename: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string(), viewId: z.string(), name: nameSchema })),
      ).mutation(
        async ({ ctx, input }) =>
          await savedViewCall(() =>
            ports.savedViews.rename({
              projectId: input.projectId,
              viewId: input.viewId,
              name: input.name,
              userId: ctx.actor().id,
            }),
          ),
      ),

      reorder: policy("traces:view")(
        procedure.input(z.object({ projectId: z.string(), viewIds: z.array(z.string()) })),
      ).mutation(
        async ({ input }) =>
          await savedViewCall(() =>
            ports.savedViews.reorder({
              projectId: input.projectId,
              viewIds: input.viewIds,
            }),
          ),
      ),
    });
  }
}
