import {
  Box,
  Button,
  Card,
  HStack,
  Heading,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { SearchInput } from "~/components/ui/SearchInput";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

export interface PaginationState {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

interface BackofficeTableProps {
  title: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  pagination?: PaginationState;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: Error | null;
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
              <Text color="red.500" fontSize="sm">
                {error.message}
              </Text>
            </Box>
          ) : isLoading ? (
            <Box paddingY={10} textAlign="center">
              <Spinner size="md" />
            </Box>
          ) : (
            <Box position="relative" width="full" overflow="auto">
              {isFetching && (
                <Box
                  position="absolute"
                  top={2}
                  right={2}
                  zIndex={1}
                  color="fg.muted"
                >
                  <Spinner size="xs" />
                </Box>
              )}
              {children}
            </Box>
          )}
        </Card.Body>
      </Card.Root>

      {pagination && pagination.total > 0 && (
        <PaginationBar {...pagination} />
      )}
    </VStack>
  );
}

function PaginationBar({
  page,
  perPage,
  total,
  onPageChange,
}: PaginationState) {
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

/** Dash placeholder for empty cell values — avoids `-` noise scattered across. */
export function EmptyCell({ children }: PropsWithChildren) {
  return (
    <Text color="fg.muted" fontSize="sm">
      {children ?? "—"}
    </Text>
  );
}

/** Human-readable date (respects locale, uses user's TZ). */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

/**
 * Turn a `<input type="date">` string (always `YYYY-MM-DD`, always the user's
 * local calendar date) into an ISO string without drifting the day.
 *
 * Background: `new Date("2026-04-16").toISOString()` parses as UTC midnight.
 * A user in PST typing "2026-04-16" and saving gets `2026-04-15T23:00:00Z`
 * back on read — shifting the calendar day. Parsing as local noon keeps the
 * date stable regardless of timezone.
 */
export function dateInputToISO(value: string): string | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  // Noon local time — gives a 12h buffer either side of UTC so the calendar
  // day stays correct in every real-world timezone.
  const d = new Date(year!, month! - 1, day!, 12, 0, 0, 0);
  return d.toISOString();
}
