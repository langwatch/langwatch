import { TRPCError } from "@trpc/server";
type DatasetError = Error & { reason?: "name_taken" | "stale_columns" };

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
export function translateDatasetError(error: unknown): unknown {
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
      message:
        error.reason === "stale_columns"
          ? "dataset_stale_columns"
          : "dataset_name_taken",
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
 * **`next()` does not throw.** tRPC v10 catches whatever the resolver raises
 * and RESOLVES with `{ ok: false, error }`, so the try/catch this middleware
 * used to be was unreachable: every conflict it existed to name arrived at the
 * customer as an unknown 500 carrying a trace id and "we've been notified" —
 * for a duplicate dataset name they could have fixed by typing a different one.
 * Nothing failed loudly, because the translating step was correct in isolation
 * and the test called it directly rather than through a `next`.
 *
 * That is also why there is no longer a `withDatasetErrorHandling(operation)`
 * wrapper for tests to drive: a helper that takes a throwing callback cannot
 * observe the one thing that was wrong, so its green test meant nothing. The
 * test now drives this middleware with a `next` that resolves the way tRPC's
 * does.
 *
 * The original error is on `error.cause` — tRPC wraps anything that is not
 * already a `TRPCError` via `getTRPCErrorFromUnknown`.
 */
export const datasetErrorHandler = async <T extends MiddlewareOutcome>({
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

function isDatasetError(error: unknown, name: string): error is DatasetError {
  return error instanceof Error && error.name === name;
}
