import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import {
  adminClient,
  type DataResult,
  type ListParams,
  type ListResult,
  type ResourceName,
  type SortOrder,
} from "./adminClient";

/**
 * React-Query hooks around the admin REST endpoints. Kept small and local —
 * this is the only file that knows the query-key shape so invalidation after
 * mutations stays consistent.
 */

const rootKey = (resource: ResourceName) => ["backoffice", resource] as const;
const listKey = (resource: ResourceName, params: ListParams) =>
  [...rootKey(resource), "list", params] as const;
const oneKey = (resource: ResourceName, id: string) =>
  [...rootKey(resource), "one", id] as const;

export function useAdminList<T>(
  resource: ResourceName,
  params: ListParams,
  options?: Omit<
    UseQueryOptions<ListResult<T>, Error, ListResult<T>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery<ListResult<T>, Error>({
    queryKey: listKey(resource, params),
    queryFn: () => adminClient.getList<T>(resource, params),
    keepPreviousData: true,
    ...options,
  });
}

export function useAdminOne<T>(
  resource: ResourceName,
  id: string | null,
  options?: Omit<
    UseQueryOptions<DataResult<T>, Error, DataResult<T>>,
    "queryKey" | "queryFn" | "enabled"
  > & { enabled?: boolean },
) {
  return useQuery<DataResult<T>, Error>({
    queryKey: oneKey(resource, id ?? ""),
    queryFn: () => adminClient.getOne<T>(resource, id!),
    enabled: !!id && (options?.enabled ?? true),
    ...options,
  });
}

export function useAdminUpdate<T>(
  resource: ResourceName,
  options?: UseMutationOptions<
    DataResult<T>,
    Error,
    { id: string; data: Record<string, unknown> }
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    DataResult<T>,
    Error,
    { id: string; data: Record<string, unknown> }
  >({
    mutationFn: ({ id, data }) => adminClient.update<T>(resource, id, data),
    ...options,
    onSuccess: async (res, vars, ctx) => {
      await qc.invalidateQueries({ queryKey: rootKey(resource) });
      options?.onSuccess?.(res, vars, ctx);
    },
  });
}

export function useAdminCreate<T>(
  resource: ResourceName,
  options?: UseMutationOptions<
    DataResult<T>,
    Error,
    Record<string, unknown>
  >,
) {
  const qc = useQueryClient();
  return useMutation<DataResult<T>, Error, Record<string, unknown>>({
    mutationFn: (data) => adminClient.create<T>(resource, data),
    ...options,
    onSuccess: async (res, vars, ctx) => {
      await qc.invalidateQueries({ queryKey: rootKey(resource) });
      options?.onSuccess?.(res, vars, ctx);
    },
  });
}

/** Re-exported for convenience in resource views. */
export type { ListParams, ListResult, SortOrder };
