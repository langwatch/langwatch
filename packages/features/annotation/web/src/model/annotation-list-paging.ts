/**
 * Which page of a list the address names, and how a page change is written.
 *
 * Lifted out of `AnnotationsTable`'s `useListPaging` closure so the two rules
 * that matter can be asserted without rendering a table: the default page size
 * and the default offset are ABSENT from the address rather than written as
 * their own defaults (a link to page one is the bare address), and a page size
 * change lands the reviewer back on the first page rather than at an offset
 * that no longer exists in the new pagination.
 */

export const DEFAULT_ANNOTATION_PAGE_SIZE = 25;

export type AnnotationListPaging = {
  /** One-based, which is what a pager displays. */
  page: number;
  pageOffset: number;
  pageSize: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** The page the address names, or the first page at the default size. */
export function readAnnotationListPaging(
  query: Readonly<Record<string, string | undefined>>,
): AnnotationListPaging {
  const pageSize = positiveInteger(query.pageSize, DEFAULT_ANNOTATION_PAGE_SIZE);
  const pageOffset = positiveInteger(query.pageOffset, 0);
  return { page: Math.floor(pageOffset / pageSize) + 1, pageOffset, pageSize };
}

/**
 * The address for a page and a size, with the defaults left out.
 *
 * `undefined` removes a key, which is what keeps page one at the default size
 * looking like the bare address it is.
 */
function pagingAddress({
  current,
  pageOffset,
  pageSize,
}: {
  current: Readonly<Record<string, string | undefined>>;
  pageOffset: number;
  pageSize: number;
}): Record<string, string | undefined> {
  return {
    ...current,
    pageOffset: pageOffset === 0 ? void 0 : String(pageOffset),
    pageSize: pageSize === DEFAULT_ANNOTATION_PAGE_SIZE ? void 0 : String(pageSize),
  };
}

/** Moves to a one-based page, keeping the size the address already has. */
export function pageAddress({
  current,
  page,
  pageSize,
}: {
  current: Readonly<Record<string, string | undefined>>;
  page: number;
  pageSize: number;
}): Record<string, string | undefined> {
  return pagingAddress({
    current,
    pageOffset: Math.max(0, page - 1) * pageSize,
    pageSize,
  });
}

/**
 * Changes how many rows a page holds, and goes back to the first one.
 *
 * Keeping the offset would land the reviewer partway down a list that has been
 * repaginated under them, at a position the old page size described and the new
 * one does not.
 */
export function pageSizeAddress({
  current,
  pageSize,
}: {
  current: Readonly<Record<string, string | undefined>>;
  pageSize: number;
}): Record<string, string | undefined> {
  return pagingAddress({ current, pageOffset: 0, pageSize });
}
