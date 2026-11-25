import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, VStack } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { AdminTable as OpsAdminTable } from "../blocks/admin-table.tsx";

type AdminTableProps = Omit<
  ComponentProps<typeof OpsAdminTable>,
  "searchInput" | "errorContent" | "createAction"
> & {
  onCreate?: () => void;
  createLabel?: string;
  /** Beside the search: the page's own filters. */
  filters?: ReactNode;
  /** Between the title and the search: a summary of what the list holds. */
  summary?: ReactNode;
};

/**
 * App composition adapter for the reusable Ops admin list shell.
 * SearchInput, PageLayout and handled-error copy are app concerns; list
 * layout and pagination behaviour lives in @langwatch/ops-browser.
 */
export function AdminTable({
  onCreate,
  createLabel = "Create",
  error,
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filters,
  summary,
  ...props
}: AdminTableProps) {
  const search = (
    <SearchInput
      value={searchValue}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder={searchPlaceholder ?? "Search"}
      maxLength={200}
      containerProps={{ width: "full", maxWidth: "lg", minWidth: 0 }}
    />
  );
  return (
    <OpsAdminTable
      {...props}
      title={title}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      searchPlaceholder={searchPlaceholder}
      error={error}
      searchInput={
        summary || filters ? (
          <VStack align="stretch" gap={4} width="full">
            {summary}
            <HStack gap={2} wrap="wrap" align="center">
              {search}
              {filters}
            </HStack>
          </VStack>
        ) : (
          search
        )
      }
      errorContent={
        error ? (
          <Box paddingY={10} paddingX={4}>
            <HandledErrorAlert
              error={error}
              fallbackTitle={`Couldn't load ${title.toLowerCase()}`}
            />
          </Box>
        ) : (
          void 0
        )
      }
      createAction={
        onCreate ? (
          <PageLayout.HeaderButton primary onClick={onCreate}>
            <Plus size={20} />
            {createLabel}
          </PageLayout.HeaderButton>
        ) : (
          void 0
        )
      }
    />
  );
}
