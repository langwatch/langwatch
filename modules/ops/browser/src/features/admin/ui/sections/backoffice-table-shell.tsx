import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box } from "@langwatch/design-system/primitives";
import { SearchInput } from "@langwatch/design-system/search-input";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plus } from "lucide-react";
import type { ComponentProps } from "react";

import { BackofficeTable as OpsBackofficeTable } from "../blocks/backoffice-table.tsx";

type BackofficeTableProps = Omit<
  ComponentProps<typeof OpsBackofficeTable>,
  "searchInput" | "errorContent" | "createAction"
> & {
  onCreate?: () => void;
  createLabel?: string;
};

/**
 * App composition adapter for the reusable Ops backoffice list shell.
 * SearchInput, PageLayout and handled-error copy are app concerns; list
 * layout and pagination behaviour lives in @langwatch/ops-browser.
 */
export function BackofficeTable({
  onCreate,
  createLabel = "Create",
  error,
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  ...props
}: BackofficeTableProps) {
  return (
    <OpsBackofficeTable
      {...props}
      title={title}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      searchPlaceholder={searchPlaceholder}
      error={error}
      searchInput={
        <SearchInput
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder ?? "Search"}
          maxLength={200}
          width="full"
          maxWidth="480px"
        />
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
