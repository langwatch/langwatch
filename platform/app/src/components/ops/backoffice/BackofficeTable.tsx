import {
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { type PaginationState } from "@langwatch/ops-web";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { SearchInput } from "~/components/ui/SearchInput";
import { HandledErrorAlert } from "~/features/errors";

interface BackofficeTableProps {
  title: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  pagination?: PaginationState;
  isLoading?: boolean;
  isFetching?: boolean;
  /**
   * The list query's failure, if any. Deliberately `unknown` — it is handed
   * straight to `HandledErrorAlert`, which lifts the handled-error payload off
   * whichever transport carried it rather than rendering `message`.
   *
   * These views fetch over plain `fetch` against the Hono `/api/admin/*`
   * routes, so the payload arrives in the flat REST shape and `adminClient`
   * copies it onto the thrown error for the reader to find.
   */
  error?: unknown;
  onCreate?: () => void;
  createLabel?: string;
  /** Slot for the <Table.Root>…</Table.Root> content. */
  children: ReactNode;
}

/**
 * Standard Backoffice list-view shell. Uses the same Heading + Card + Table
 * rhythm as `/settings/members` so every admin resource page looks and feels
 * like the rest of Settings — see `members.tsx` for the reference pattern.
 *
 * Intentionally thin: the view owns the table rows, this only handles the
 * repeatable chrome (title, search, loading/empty/error, pagination).
 */
export function BackofficeTable({
  title,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search",
  pagination,
  isLoading,
  isFetching,
  error,
  onCreate,
  createLabel = "Create",
  children,
}: BackofficeTableProps) {
  return (
    <VStack gap={6} width="full" align="start">
      <HStack width="full">
        <Heading>{title}</Heading>
        <Spacer />
        {onCreate && (
          <PageLayout.HeaderButton onClick={onCreate}>
            <Plus size={20} />
            {createLabel}
          </PageLayout.HeaderButton>
        )}
      </HStack>

      <SearchInput
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        width="full"
        maxWidth="480px"
      />

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          {error ? (
            <Box paddingY={10} paddingX={4}>
              <HandledErrorAlert
                error={error}
                fallbackTitle={`Couldn't load ${title.toLowerCase()}`}
              />
            </Box>
          ) : isLoading ? (
            <Box paddingY={10} textAlign="center">
              <Spinner size="md" />
            </Box>
          ) : (
            <Box position="relative" width="full" overflow="auto">
              {isFetching && (
                <Box position="absolute" top={2} right={2} zIndex={1} color="fg.muted">
                  <Spinner size="xs" />
                </Box>
              )}
              {children}
            </Box>
          )}
        </Card.Body>
      </Card.Root>

      {pagination && pagination.total > 0 && <PaginationBar {...pagination} />}
    </VStack>
  );
}

function PaginationBar({ page, perPage, total, onPageChange }: PaginationState) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const rangeStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(total, page * perPage);

  return (
    <HStack width="full" justify="end" gap={4}>
      <Text fontSize="sm" color="fg.muted">
        {rangeStart}–{rangeEnd} of {total}
      </Text>
      <HStack gap={1}>
        <Button
          size="sm"
          variant="outline"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </HStack>
    </HStack>
  );
}
