import { useInvalidateProcedure } from "@langwatch/platform-api-client";
import { readChangeTraceNameRejection } from "@langwatch/trace-contract";
import { traceApi } from "../trace-api";

/**
 * How a rename turned out.
 */
export type RenameTraceOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "too-long";
      error: unknown;
      maxLength: number;
      receivedLength: number;
    }
  | { ok: false; reason: "unknown"; error: unknown };

export type UseRenameTraceResult = {
  rename: (input: {
    projectId: string;
    traceId: string;
    newName: string;
  }) => Promise<RenameTraceOutcome>;
  isPending: boolean;
};

/**
 * INTERNAL. Renaming a trace, and putting the caches that show its name back in order
 * afterwards.
 */
export function useRenameTrace(): UseRenameTraceResult {
  const utils = traceApi.useUtils();
  const invalidateProcedure = useInvalidateProcedure();

  const mutation = traceApi.tracesV2.changeName.useMutation({
    onSuccess: async ({ traceId }, variables) => {
      // Everything that paints this trace's name: the drawer title (header) and the
      // table cells and tooltips (list).
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
        if (!rejection) return { ok: false, reason: "unknown", error };
        return {
          ok: false,
          reason: "too-long",
          error,
          maxLength: rejection.maxLength,
          receivedLength: rejection.receivedLength,
        };
      }
    },
    isPending: mutation.isPending,
  };
}
