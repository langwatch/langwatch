/**
 * The `/dashboards` library's search, filters and pressed column header, and the rows they
 * leave. Held for the visit only: a reload opens the whole library again.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { useState } from "react";

import {
  filterLibraryBoards,
  hasLibraryFilters,
  type LibraryFilters,
  type LibrarySort,
  libraryProductChips,
  librarySummary,
  nextLibrarySort,
  NO_LIBRARY_FILTERS,
  sortLibraryBoards,
} from "../model/library-filters.ts";
import { type LibraryBoard, libraryRows } from "../model/organization-library.ts";

export function useLibraryFilters({
  boards,
  userId,
}: {
  boards: readonly LibraryBoard[];
  userId: string | undefined;
}) {
  const [filters, setFilters] = useState<LibraryFilters>(NO_LIBRARY_FILTERS);
  const [sort, setSort] = useState<LibrarySort | undefined>();
  const narrowed = filterLibraryBoards({ boards: libraryRows({ boards }), filters, userId });
  const rows = sortLibraryBoards({ boards: narrowed, sort });
  const isFiltered = hasLibraryFilters(filters);

  return {
    filters,
    rows,
    sort,
    isFiltered,
    productChips: libraryProductChips({ boards, filters, userId }),
    summary: isFiltered ? librarySummary({ shown: rows.length, total: boards.length }) : void 0,
    change: (change: Partial<LibraryFilters>) => setFilters({ ...filters, ...change }),
    clear: () => setFilters(NO_LIBRARY_FILTERS),
    sortBy: (column: LibrarySort["column"]) => setSort(nextLibrarySort({ sort, column })),
  };
}
