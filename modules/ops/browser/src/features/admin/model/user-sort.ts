import { type AdminUserSortField, adminUserSortFieldSchema } from "@langwatch/ops-contract";

export type UserSortDirection = "asc" | "desc";

/** The users list's chosen order; null is the default, newest first. */
export type UserSort = { field: AdminUserSortField; direction: UserSortDirection } | null;

const DEFAULT_ORDER = { field: "createdAt", order: "DESC" } as const;

/**
 * The order the address states (`?sort=name&order=desc`), or null when it states none or
 * nonsense.
 */
export function readUserSort(query: Readonly<Record<string, string | undefined>>): UserSort {
  const field = adminUserSortFieldSchema.safeParse(query.sort);
  if (!field.success) return null;
  return { field: field.data, direction: query.order === "desc" ? "desc" : "asc" };
}

/** A header click: ascending first, then descending, then back to the default order. */
export function nextUserSort({
  current,
  field,
}: {
  current: UserSort;
  field: AdminUserSortField;
}): UserSort {
  if (current?.field !== field) return { field, direction: "asc" };
  if (current.direction === "asc") return { field, direction: "desc" };
  return null;
}

/** The order the list read asks the server for. */
export function userSortParams(sort: UserSort): {
  field: AdminUserSortField;
  order: "ASC" | "DESC";
} {
  if (!sort) return DEFAULT_ORDER;
  return { field: sort.field, order: sort.direction === "desc" ? "DESC" : "ASC" };
}

/** The address query with this order written in, keeping every other key. */
export function withUserSort({
  query,
  sort,
}: {
  query: Readonly<Record<string, string | undefined>>;
  sort: UserSort;
}): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...query };
  delete next.sort;
  delete next.order;
  if (sort) {
    next.sort = sort.field;
    next.order = sort.direction;
  }
  return next;
}
