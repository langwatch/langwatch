import { useInvalidateProcedure } from "@langwatch/platform-api-client";
import { readChangeTraceNameRejection } from "@langwatch/trace-contract";
import { traceApi } from "../trace-api";

export type RenameTraceOutcome =
  | { ok: true }
  | { ok: false; reason: "too-long"; maxLength: number; receivedLength: number }
  | { ok: false; reason: "unknown" };

export type UseRenameTraceResult = {
  rename: (input: {
    projectId: string;
    traceId: string;
    newName: string;
  }) => Promise<RenameTraceOutcome>;
  isPending: boolean;
};

/**
 * INTERNAL. Renaming a trace, and putting the caches that show its name back in
 * order afterwards.
 *
 * It lives under `src/internal/` and nothing re-exports it, so it is reachable
 * from Trace's own modules and from nowhere else. That is the whole mechanism:
 * `src/index.ts` never exports from `internal/`, and the package manifest has no
 * `exports` entry that reaches inside it, so another feature importing this is a
 * resolution error rather than a coupling nobody notices.
 *
 * It is internal because renaming is a thing the trace drawer does, not a thing
 * other features ask Trace about. If that changes — a bulk-rename surface in
 * Ops, say — promoting it costs three things: `RenameTraceOutcome` and the
 * argument type must move to `@langwatch/trace-contract`, because a caller
 * cannot depend on types declared in a file it may not import; the name becomes
 * one other packages compile against; and the invalidation set below becomes a
 * promise rather than an implementation detail. Do that deliberately, in a
 * change of its own, not as a side effect of a second caller appearing.
 *
 * The outcome is returned rather than toasted. A rejection's SHAPE is the
 * server's and belongs here; the words a customer reads belong with the
 * component that shows them (ADR-045).
 */
export function useRenameTrace(): UseRenameTraceResult {
  const utils = traceApi.useUtils();
  const invalidateProcedure = useInvalidateProcedure();

  const mutation = traceApi.tracesV2.changeName.useMutation({
    onSuccess: async ({ traceId }, variables) => {
      // Everything that paints this trace's name: the drawer title (header) and
      // the table cells and tooltips (list).
      //
      // `header` goes through `useUtils` because `TraceApiMap` declares it.
      // `tracesV2.list` is not declared yet — it is still read only by
      // application hooks — so there is no typed handle for it here, and
      // `useInvalidateProcedure` builds the key tRPC would have built. That is
      // what makes this reach the application's `api.tracesV2.list.useQuery`
      // entries. When `list` joins the map, replace that line with
      // `utils.tracesV2.list.invalidate()` and drop the import.
      await Promise.all([
        utils.tracesV2.header.invalidate({ projectId: variables.projectId, traceId }),
        invalidateProcedure("tracesV2.list"),
      ]);
    },
  });

  return {
    rename: async (input) => {
      try {
        await mutation.mutateAsync(input);
        return { ok: true };
      } catch (error) {
        const rejection = readChangeTraceNameRejection(
          (error as { data?: { error?: { meta?: unknown } } })?.data?.error?.meta,
        );
        if (!rejection) return { ok: false, reason: "unknown" };
        return {
          ok: false,
          reason: "too-long",
          maxLength: rejection.maxLength,
          receivedLength: rejection.receivedLength,
        };
      }
    },
    isPending: mutation.isPending,
  };
}
