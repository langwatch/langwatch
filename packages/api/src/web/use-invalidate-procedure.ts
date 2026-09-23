import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { trpcQueryFilter } from "./trpc-query-key.ts";

/** Invalidates a procedure the feature's map does not declare (migration escape hatch);
 * prefer `moduleApi.useUtils().<procedure>.invalidate()` once declared */
export function useInvalidateProcedure() {
  const queryClient = useQueryClient();

  return useCallback(
    async (path: string, options: { input?: unknown } = {}) => {
      await queryClient.invalidateQueries(trpcQueryFilter(path, options));
    },
    [queryClient],
  );
}
