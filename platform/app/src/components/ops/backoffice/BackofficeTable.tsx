import { Box } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { BackofficeTable as OpsBackofficeTable } from "@langwatch/ops-web";
import { SearchInput } from "~/components/ui/SearchInput";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { HandledErrorAlert } from "~/features/errors";

type BackofficeTableProps = Omit<
  ComponentProps<typeof OpsBackofficeTable>,
  "searchInput" | "errorContent" | "createAction"
> & {
  onCreate?: () => void;
  createLabel?: string;
};

/**
 * App composition adapter for the reusable Ops backoffice list shell.
 *
 * SearchInput, PageLayout, and handled-error copy are app concerns; all list
 * layout and pagination behaviour lives in @langwatch/ops-web.
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
          <PageLayout.HeaderButton onClick={onCreate}>
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
