/**
 * The project's datasets over a host's tRPC transport.
 *
 *   upsert:              create a dataset, or replace an existing one's columns
 *                        and entries. Also the path the experiment pages take,
 *                        which name an `experimentId` instead of a `name` and
 *                        borrow the experiment's.
 *   validateDatasetName: the editor's live name check — the slug a name would
 *                        get, and whether it is free.
 *   findNextName:        the next free name for a proposed one, for the
 *                        "duplicate this" affordances.
 *   getAll:              the project's datasets for the list page, the picker,
 *                        the command bar and the automations pages.
 *   getById:             one dataset by id or slug; an archived or missing one
 *                        reads as null rather than failing the page.
 *   deleteById:          archive, and the undo that restores.
 *   updateMapping:       the trace/thread mapping a dataset is filled from.
 *   copy:                the same dataset in another project.
 *
 * Reading takes `datasets:view`; creating takes `datasets:create`, editing
 * `datasets:update`, replacing `datasets:manage`, and archiving
 * `datasets:delete`.
 *
 * Transport only: policy, error translation, and delegation to `DatasetApp`.
 *
 * Spec: packages/features/dataset/specs/dataset-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  datasetApiCopyInputSchema,
  datasetApiDatasetInputSchema,
  datasetApiDeleteInputSchema,
  datasetApiFindNextNameInputSchema,
  datasetApiProjectInputSchema,
  datasetApiUpdateMappingInputSchema,
  datasetApiUpsertBaseInputSchema,
  datasetApiUpsertTargetInputSchema,
  datasetApiValidateNameInputSchema,
} from "@langwatch/dataset-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import type { DatasetApp } from "#app/dataset.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the host's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. The REST family, built per
 * process, holds {@link DatasetApp} directly. Both reach the same object; only
 * the path to it differs.
 */
export type DatasetTrpcContext = Readonly<{ app: Readonly<{ dataset: DatasetApp }> }>;

type DatasetTrpcProcedures<
  TContext extends DatasetTrpcContext,
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
 * The host capabilities this transport needs that are not Dataset's own.
 *
 * Each method is handed the request context so the host resolves the caller
 * exactly as it always did.
 */
export type DatasetTrpcPorts = Readonly<{
  /**
   * Whether the caller holds `permission` on `projectId`. `copy` reads a
   * SECOND project the declared check never covers — the source — so the
   * source project is probed separately before anything is read from it.
   */
  probeProjectPermission(
    ctx: DatasetTrpcContext,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
}>;

/** A dataset error carrying the discriminator a conflict needs. */
type DatasetError = Error & { reason?: "name_taken" | "stale_columns" };

function isDatasetError(error: unknown, name: string): error is DatasetError {
  return error instanceof Error && error.name === name;
}

/**
 * Translates the dataset domain errors that still need it at the tRPC
 * boundary, and hands back everything else untouched.
 *
 * Most of the family needs nothing here: `DatasetNotReadyError` and
 * `ColumnTypeChangeNotSupportedError` are `HandledError`s in their own right,
 * so they carry their code, status and meta across the boundary untouched.
 * What is left is the ambiguous one — a `DatasetConflictError` is two different
 * failures wearing one class — plus the not-found case that has no handled form
 * yet.
 *
 * Returns the SAME reference it was given when there is nothing to do, so the
 * caller can tell "translated this" from "left this alone" without a second
 * predicate that could disagree.
 */
function translateDatasetError(error: unknown): unknown {
  if (isDatasetError(error, "DatasetNotFoundError")) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: error.message,
    });
  }

  // Both conflicts are knowable and both are actionable, but not by the same
  // action — a name clash is fixed by renaming, a stale editor by reloading.
  // Collapsing them onto one code told the second caller to pick a different
  // name, which could never resolve their failure (ADR-045). `message` here
  // is server copy; the customer-facing words live in the client's
  // presentation registry, keyed by these codes.
  if (isDatasetError(error, "DatasetConflictError")) {
    return new TRPCError({
      code: "CONFLICT",
      message: error.reason === "stale_columns" ? "dataset_stale_columns" : "dataset_name_taken",
      cause: error,
    });
  }

  return error;
}

/**
 * What a tRPC middleware's `next()` resolves to. Declared structurally rather
 * than imported: tRPC exports `MiddlewareResult` as an internal type, and all
 * this needs is the discriminant and the error beside it.
 */
interface MiddlewareOutcome {
  ok: boolean;
  error?: TRPCError;
}

/**
 * tRPC middleware that translates dataset domain errors into the codes the
 * client contract expects. Usage: `procedure.use(datasetErrorHandler)`.
 *
 * **`next()` does not throw.** tRPC catches whatever the resolver raises and
 * RESOLVES with `{ ok: false, error }`, so the try/catch this middleware used
 * to be was unreachable: every conflict it existed to name arrived at the
 * customer as an unknown 500 carrying a trace id and "we've been notified" —
 * for a duplicate dataset name they could have fixed by typing a different one.
 *
 * The original error is on `error.cause` — tRPC wraps anything that is not
 * already a `TRPCError` via `getTRPCErrorFromUnknown`.
 */
const datasetErrorHandler = async <T extends MiddlewareOutcome>({
  next,
}: {
  next: () => Promise<T>;
}): Promise<T> => {
  const result = await next();
  if (result.ok || !result.error) return result;

  const cause = result.error.cause ?? result.error;
  const translated = translateDatasetError(cause);

  // Nothing of ours. Hand tRPC back its own result rather than re-throwing:
  // an infrastructure failure keeps the code, logging and trace id it already
  // had, and does not get re-wrapped on the way past.
  if (translated === cause) return result;

  throw translated;
};

/**
 * Installs the complete `dataset.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 *
 * Slugs are generated from the dataset name and follow it when it changes, so
 * `getById` takes either; uniqueness is `(projectId, slug)` in the database.
 * All of that is service behaviour — nothing here decides it.
 */
export class DatasetTrpcApi {
  static create<
    TContext extends DatasetTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: DatasetTrpcProcedures<TContext, TOptions, TRoot>,
    ports: DatasetTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /** Creates a new dataset or replaces an existing one's shape. */
      upsert: policy("datasets:manage")(
        procedure.input(datasetApiUpsertBaseInputSchema).input(datasetApiUpsertTargetInputSchema),
      )
        .use(datasetErrorHandler)
        .mutation(async ({ ctx, input }) => {
          // Borrowing the experiment's name when the caller named one is the
          // application's rule, not this transport's: the REST patch fills the
          // same hole from the dataset it is replacing, and one upsert decides
          // both.
          return await ctx.app.dataset.upsertDataset({
            projectId: input.projectId,
            name: "name" in input ? input.name : undefined,
            experimentId: "experimentId" in input ? input.experimentId : undefined,
            columnTypes: input.columnTypes,
            datasetId: "datasetId" in input ? input.datasetId : undefined,
            datasetRecords: input.datasetRecords,
          });
        }),

      /** The slug a proposed name would get, and whether it is available. */
      validateDatasetName: policy("datasets:view")(
        procedure.input(datasetApiValidateNameInputSchema),
      )
        .use(datasetErrorHandler)
        .query(async ({ input, ctx }) => {
          return await ctx.app.dataset.validateDatasetName(input);
        }),

      /** Every dataset in the project, for the list and picker surfaces. */
      getAll: policy("datasets:view")(procedure.input(datasetApiProjectInputSchema)).query(
        async ({ input, ctx }) => {
          const result = await ctx.app.dataset.listDatasets({
            projectId: input.projectId,
            page: 1,
            limit: 200,
          });
          return result.data;
        },
      ),

      /**
       * One dataset by id or slug. An archived or missing one reads as null
       * rather than failing the page that asked for it.
       */
      getById: policy("datasets:view")(procedure.input(datasetApiDatasetInputSchema)).query(
        async ({ input, ctx }) => {
          try {
            return await ctx.app.dataset.getBySlugOrId({
              projectId: input.projectId,
              slugOrId: input.datasetId,
            });
          } catch (error) {
            if (error instanceof Error && error.name === "DatasetNotFoundError") return null;
            throw error;
          }
        },
      ),

      /** Archives a dataset, or restores one the caller just archived. */
      deleteById: policy("datasets:delete")(procedure.input(datasetApiDeleteInputSchema)).mutation(
        async ({ ctx, input }) => {
          if (input.undo) {
            return ctx.app.dataset.restoreDataset({
              datasetId: input.datasetId,
              projectId: input.projectId,
            });
          }
          await ctx.app.dataset.archiveDataset({
            slugOrId: input.datasetId,
            projectId: input.projectId,
          });
          return { success: true as const };
        },
      ),

      /** The trace and thread mapping a dataset is filled from. */
      updateMapping: policy("datasets:update")(
        procedure.input(datasetApiUpdateMappingInputSchema),
      ).mutation(async ({ ctx, input }) => {
        return ctx.app.dataset.updateMapping(input);
      }),

      /** The next free name for a proposed one. */
      findNextName: policy("datasets:view")(procedure.input(datasetApiFindNextNameInputSchema))
        .use(datasetErrorHandler)
        .query(async ({ input, ctx }) => {
          return await ctx.app.dataset.findNextAvailableName(input);
        }),

      /**
       * Copies a dataset into another project, records and all. Name clashes
       * in the target get a suffix.
       */
      copy: policy("datasets:create")(procedure.input(datasetApiCopyInputSchema))
        .use(datasetErrorHandler)
        .mutation(async ({ ctx, input }) => {
          // The declared check covers `projectId`, the TARGET. The source is a
          // second project the caller also named, so it is probed here —
          // holding create on a project implies being able to read its
          // datasets, which is what a copy does.
          const hasSourcePermission = await ports.probeProjectPermission(
            ctx,
            input.sourceProjectId,
            "datasets:create",
          );

          if (!hasSourcePermission) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to view datasets in the source project",
            });
          }

          return await ctx.app.dataset.copyDataset({
            sourceDatasetId: input.datasetId,
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.projectId,
          });
        }),
    });
  }
}
