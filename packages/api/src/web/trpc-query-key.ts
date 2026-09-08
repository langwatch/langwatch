/**
 * tRPC's React Query cache key, rebuilt from a procedure path string.
 *
 * A feature's `createFeatureApi` binding can only name the procedures that
 * feature's map declares, and during the migration that is a fraction of the
 * real router — and never another feature's. A package hook regularly
 * needs to invalidate a procedure that has NOT been declared yet — a moved
 * rename invalidating `tracesV2.list`, say, while `list` is still read only by
 * application hooks. This is how it does that without hand-writing tRPC's key
 * encoding at the call site and getting it subtly wrong.
 *
 * The encoding is `@trpc/react-query`'s `getQueryKeyInternal`:
 *
 *     path only            ->  [["tracesV2", "list"]]
 *     path + input         ->  [["tracesV2", "header"], { input }]
 *     path + input + type  ->  [["tracesV2", "header"], { input, type: "query" }]
 *
 * The nested array is what makes a path-only key a PREFIX of every keyed query
 * under it, which is what lets `invalidateQueries` match a whole procedure.
 *
 * Reach for this only for a procedure the feature's map does not declare. Once
 * it does, `featureApi.useUtils().tracesV2.list.invalidate()` says the same
 * thing with the types checked, and a typo in a path string here is a silent
 * no-op rather than a compile error.
 */

export type TrpcQueryKey =
  | readonly [readonly string[]]
  | readonly [readonly string[], { input?: unknown; type?: "query" | "infinite" }];

/**
 * The cache key `@trpc/react-query` would have produced for this procedure.
 *
 * Omit `input` for the procedure-wide key: it prefix-matches every input, which
 * is what an "everything under this procedure is stale" invalidation wants.
 */
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

/**
 * A React Query filter for one tRPC procedure, ready to hand to
 * `invalidateQueries` / `cancelQueries` / `removeQueries`.
 *
 *     await queryClient.invalidateQueries(trpcQueryFilter("tracesV2.list"));
 */
export function trpcQueryFilter(
  path: string,
  options: { input?: unknown } = {},
): { queryKey: TrpcQueryKey } {
  return { queryKey: trpcQueryKey(path, options) };
}
