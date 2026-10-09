import { LENS_CAPABILITIES } from "../../lens/capabilities";
import {
  PAGE_SIZE_OPTIONS,
  type SetGroupingPayload,
  type SetLensPayload,
  type SetPagePayload,
  type SetPageSizePayload,
  type SetSortPayload,
  setGroupingPayloadSchema,
  setLensPayloadSchema,
  setPagePayloadSchema,
  setPageSizePayloadSchema,
  setSortPayloadSchema,
} from "../schemas";
import { ExplorerTransformError, type Transform } from "./types";

/**
 * Open a lens. With the page's lens list in hand the lens brings its own
 * filter, sort, grouping and columns, and an id the list does not hold is
 * refused. Without the list (the away fallback) only the id moves, and the
 * page installs the rest when it opens.
 */
export const setLens: Transform<SetLensPayload, { lensId: string }> = ({
  state,
  payload,
  context,
}) => {
  const { lensId } = setLensPayloadSchema.parse(payload);
  if (!context?.lenses) {
    return {
      state: { ...state, activeLensId: lensId, page: 1 },
      result: { lensId },
    };
  }
  const lens = context.lenses.find((candidate) => candidate.id === lensId);
  if (!lens) {
    throw new ExplorerTransformError({
      code: "lens_not_found",
      message: `No lens "${lensId}" on this page`,
      meta: { lensId, known: context.lenses.map((candidate) => candidate.id) },
    });
  }
  return {
    state: {
      ...state,
      activeLensId: lens.id,
      queryText: lens.filterText,
      sort: lens.sort,
      grouping: lens.grouping,
      columnOrder: lens.columns,
      page: 1,
      expandedRows: new Set<string>(),
    },
    result: { lensId: lens.id },
  };
};

/** Sort by a column the current grouping's table can sort by. */
export const setSort: Transform<
  SetSortPayload,
  { columnId: string; direction: "asc" | "desc" }
> = ({ state, payload }) => {
  const sort = setSortPayloadSchema.parse(payload);
  const sortable = LENS_CAPABILITIES[state.grouping].sortableColumnIds;
  if (!sortable.includes(sort.columnId)) {
    throw new ExplorerTransformError({
      code: "sort_column_unknown",
      message: `The ${state.grouping} table cannot sort by "${sort.columnId}"`,
      meta: { columnId: sort.columnId, sortable: [...sortable] },
    });
  }
  return { state: { ...state, sort, page: 1 }, result: sort };
};

/**
 * Regroup the table. A sort the new table cannot honour falls back to that
 * table's own default, and the open rows close because their keys name rows
 * of the old grouping.
 */
export const setGrouping: Transform<
  SetGroupingPayload,
  { grouping: SetGroupingPayload["grouping"] }
> = ({ state, payload }) => {
  const { grouping } = setGroupingPayloadSchema.parse(payload);
  const capability = LENS_CAPABILITIES[grouping];
  const sort = capability.sortableColumnIds.includes(state.sort.columnId)
    ? state.sort
    : { ...capability.defaultSort };
  return {
    state: {
      ...state,
      grouping,
      sort,
      page: 1,
      expandedRows: new Set<string>(),
    },
    result: { grouping },
  };
};

/** Go to a page, bounded by the last read's count when there was one. */
export const setPage: Transform<SetPagePayload, { page: number }> = ({
  state,
  payload,
  context,
}) => {
  const { page } = setPagePayloadSchema.parse(payload);
  const totalHits = context?.totalHits;
  if (typeof totalHits === "number") {
    const lastPage = Math.max(1, Math.ceil(totalHits / state.pageSize));
    if (page > lastPage) {
      throw new ExplorerTransformError({
        code: "page_out_of_range",
        message: `Page ${page} is past the last page, ${lastPage}`,
        meta: { page, lastPage },
      });
    }
  }
  return { state: { ...state, page }, result: { page } };
};

export const setPageSize: Transform<
  SetPageSizePayload,
  { pageSize: number }
> = ({ state, payload }) => {
  const { pageSize } = setPageSizePayloadSchema.parse(payload);
  if (!(PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)) {
    throw new ExplorerTransformError({
      code: "page_size_invalid",
      message: `A page holds one of ${PAGE_SIZE_OPTIONS.join(", ")} rows`,
      meta: { pageSize, offered: [...PAGE_SIZE_OPTIONS] },
    });
  }
  return { state: { ...state, pageSize, page: 1 }, result: { pageSize } };
};
