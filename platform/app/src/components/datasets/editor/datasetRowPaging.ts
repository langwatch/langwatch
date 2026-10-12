/**
 * The dataset-editor deep-link (issue #8190) for one row — e.g. an
 * experiment result row's "View in dataset" link. `?row=` is read by the
 * dataset page itself, which turns it back into a page + highlighted row
 * via `pageForRowIndex`.
 */
export function datasetEntryDeepLinkHref({
  projectSlug,
  datasetId,
  index,
}: {
  projectSlug: string;
  datasetId: string;
  index: number;
}): string {
  return `/${projectSlug}/datasets/${datasetId}?row=${index}`;
}

/**
 * A `?row=` query value as a row index, or `undefined` for anything that
 * isn't a plain non-negative integer. Malformed or absent is the right
 * failure mode here, not an error — a link the user didn't follow (a bare
 * `/datasets/:id` visit, or a stray `?row=` from somewhere unrelated)
 * should land on page 1 rather than surface a parsing complaint.
 *
 * `Number.isSafeInteger` rather than just checking the regex matched:
 * a long enough digit string still passes `/^\d+$/` but rounds (or hits
 * `Infinity`) once converted, which would hand `pageForRowIndex` a value
 * that resolves to the wrong page rather than failing closed.
 */
export function parseRowQueryParam(
  rowParam: string | string[] | undefined,
): number | undefined {
  if (typeof rowParam !== "string" || !/^\d+$/.test(rowParam)) return undefined;
  const parsed = Number(rowParam);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Where a dataset's Nth row (zero-based, createdAt-ascending — the same
 * order `listPaginated` and the experiment-run dataset snapshot both use)
 * lands in the classic-pager dataset editor: which page it is on, and its
 * position within that page's rows.
 */
export function pageForRowIndex({
  index,
  pageSize,
}: {
  index: number;
  pageSize: number;
}): { page: number; indexOnPage: number } {
  return {
    page: Math.floor(index / pageSize) + 1,
    indexOnPage: index % pageSize,
  };
}
