import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { trpcQueryFilter } from "./trpc-query-key";

/**
 * Invalidates a procedure this feature's map does not declare.
 *
 * The escape hatch for the migration's normal case: a hook has moved into a
 * feature package, and it has to invalidate something that has not moved and
 * belongs to another feature — a rename in Trace refreshing a list the
 * application still owns.
 *
 * Prefer `featureApi.useUtils().<procedure>.invalidate()` whenever the map
 * declares the procedure. This takes a string, so a typo is a silent no-op
 * rather than a compile error, and that is exactly why it should be the second
 * choice rather than the habit.
 */
export function useInvalidateProcedure() {
  const queryClient = useQueryClient();

  return useCallback(
    async (path: string, options: { input?: unknown } = {}) => {
      await queryClient.invalidateQueries(trpcQueryFilter(path, options));
    },
    [queryClient],
  );
}
