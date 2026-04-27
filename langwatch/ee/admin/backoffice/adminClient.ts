/**
 * Thin typed wrapper around the Hono `/api/admin/:resource` endpoints.
 *
 * The backend (see `ee/admin/routes/admin.ts`) is the same
 * `ra-data-simple-prisma` handler that used to back the react-admin UI:
 * every call is a POST with `{ resource, method, params }`. We keep using it
 * untouched so all business logic (user deactivate/reactivate side effects,
 * org ssoDomain normalization, subscription list join, search logic, audit
 * logs) remains unchanged — only the UI is rewritten.
 */

export type ResourceName =
  | "user"
  | "organization"
  | "project"
  | "subscription"
  | "organizationFeature";

export type SortOrder = "ASC" | "DESC";

export interface ListParams {
  pagination?: { page: number; perPage: number };
  sort?: { field: string; order: SortOrder };
  filter?: Record<string, unknown>;
}

export interface ListResult<T> {
  data: T[];
  total: number;
}

export interface DataResult<T> {
  data: T;
}

async function adminFetch<T>(
  resource: ResourceName,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/admin/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource, method, params }),
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      `Admin ${resource}/${method} failed (${res.status}): ${text}`,
    );
  }

  return (await res.json()) as T;
}

export const adminClient = {
  getList<T>(resource: ResourceName, params: ListParams): Promise<ListResult<T>> {
    const {
      pagination = { page: 1, perPage: 25 },
      sort = { field: "id", order: "ASC" as const },
      filter = {},
    } = params;
    return adminFetch<ListResult<T>>(resource, "getList", {
      pagination,
      sort,
      filter,
    });
  },

  getOne<T>(resource: ResourceName, id: string): Promise<DataResult<T>> {
    return adminFetch<DataResult<T>>(resource, "getOne", { id });
  },

  update<T>(
    resource: ResourceName,
    id: string,
    data: Record<string, unknown>,
  ): Promise<DataResult<T>> {
    return adminFetch<DataResult<T>>(resource, "update", { id, data });
  },

  create<T>(
    resource: ResourceName,
    data: Record<string, unknown>,
  ): Promise<DataResult<T>> {
    return adminFetch<DataResult<T>>(resource, "create", { data });
  },
};

/**
 * Impersonation is a separate endpoint (`/api/admin/impersonate`) that takes
 * a non-resource body. Exposed here so the Users table can reuse it without
 * duplicating fetch plumbing.
 */
export async function impersonateUser({
  userIdToImpersonate,
  reason,
}: {
  userIdToImpersonate: string;
  reason: string;
}): Promise<void> {
  const res = await fetch(`/api/admin/impersonate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIdToImpersonate, reason }),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Impersonation failed (${res.status}): ${text}`);
  }
}
