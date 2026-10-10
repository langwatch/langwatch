/** tRPC's React Query cache key rebuilt from a procedure path string; for procedures
 * not yet declared in the feature's map; use typed API once declared */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export type TrpcQueryKey =
  | readonly [readonly string[]]
  | readonly [readonly string[], { input?: unknown; type?: "query" | "infinite" }];

/** Cache key compatible with `@trpc/react-query`; omit input for all inputs. */
export function trpcQueryKey(
  path: string,
  options: { input?: unknown; type?: "query" | "infinite" } = {},
): TrpcQueryKey {
  const splitPath = path.split(".").filter((part) => part.length > 0);
  const { input, type } = options;

  if (input === void 0 && type === void 0) {
    return [splitPath];
  }

  return [
    splitPath,
    {
      ...(input !== void 0 ? { input } : {}),
      ...(type !== void 0 ? { type } : {}),
    },
  ];
}

/** React Query filter for one tRPC procedure. */
export function trpcQueryFilter(
  path: string,
  options: { input?: unknown } = {},
): { queryKey: TrpcQueryKey } {
  return { queryKey: trpcQueryKey(path, options) };
}

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
