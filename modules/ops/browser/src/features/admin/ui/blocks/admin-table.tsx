import { ListPage, ListPageError } from "@langwatch/design-system/list-page";
import { SearchInput } from "@langwatch/design-system/search-input";
import type { ReactNode } from "react";

import type { PaginationState } from "../elements/admin-cells.tsx";

export interface AdminTableProps {
  title: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  pagination?: PaginationState;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  /** Optional app-owned error presentation for handled transport failures. */
  errorContent?: ReactNode;
  /** Optional app-owned search control; SearchInput remains the default. */
  searchInput?: ReactNode;
  /** Optional app-owned create action, usually a page-specific button. */
  createAction?: ReactNode;
  children: ReactNode;
}

/** Adapts Ops resource paging and errors to the shared list-page composition. */
export function AdminTable({
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search",
  pagination,
  isLoading,
  isFetching,
  error,
  errorContent,
  searchInput,
  createAction,
  children,
}: AdminTableProps) {
  return (
    <ListPage
      title={title}
      actions={createAction}
      loading={isLoading}
      refreshing={isFetching}
      error={
        error
          ? (errorContent ?? <ListPageError title={`Couldn't load ${title.toLowerCase()}`} />)
          : void 0
      }
      toolbar={
        searchInput ?? (
          <SearchInput
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
          />
        )
      }
      pagination={
        pagination
          ? {
              page: pagination.page,
              pageSize: pagination.perPage,
              totalCount: pagination.total,
              onPageChange: pagination.onPageChange,
              unitLabel: title.toLowerCase(),
            }
          : void 0
      }
    >
      {children}
    </ListPage>
  );
}
