import {
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { PaginationState } from "../elements/backoffice-cells";

export interface BackofficeTableProps {
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
  /** Optional app-owned search control; the Chakra input remains the default. */
  searchInput?: ReactNode;
  /** Optional app-owned create action, usually a page-specific button. */
  createAction?: ReactNode;
  children: ReactNode;
}

/**
 * Controlled list-view chrome shared by Ops backoffice resources.
 *
 * Resource queries, routing, and handled-error copy stay in the application;
 * this package owns the stable heading, search, card, loading, and paging
 * presentation. Slots are deliberately named and narrow so app composition
 * does not become a hidden context or transport dependency.
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
  errorContent,
  searchInput,
  createAction,
  children,
}: BackofficeTableProps) {
  return (
    <VStack gap={6} width="full" align="start">
      <HStack width="full">
        <Heading>{title}</Heading>
        <Spacer />
        {createAction}
      </HStack>

      {searchInput ?? (
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          width="full"
          maxWidth="480px"
        />
      )}

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0}>
          <BackofficeTableContent
            title={title}
            error={error}
            errorContent={errorContent}
            isLoading={isLoading}
            isFetching={isFetching}
          >
            {children}
          </BackofficeTableContent>
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
          aria-label="Previous page"
          size="sm"
          variant="outline"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <Button
          aria-label="Next page"
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

interface BackofficeTableContentProps {
  title: string;
  error?: unknown;
  errorContent?: ReactNode;
  isLoading?: boolean;
  isFetching?: boolean;
  children: ReactNode;
}

function BackofficeTableContent({
  title,
  error,
  errorContent,
  isLoading,
  isFetching,
  children,
}: BackofficeTableContentProps) {
  if (error) {
    return (
      errorContent ?? (
        <Box paddingY={10} paddingX={4}>
          <Text color="red.500">Couldn&apos;t load {title.toLowerCase()}</Text>
        </Box>
      )
    );
  }

  if (isLoading) {
    return (
      <Box paddingY={10} textAlign="center">
        <Spinner size="md" />
      </Box>
    );
  }

  return (
    <Box position="relative" width="full" overflow="auto">
      {isFetching && (
        <Box position="absolute" top={2} right={2} zIndex={1} color="fg.muted">
          <Spinner size="xs" />
        </Box>
      )}
      {children}
    </Box>
  );
}
