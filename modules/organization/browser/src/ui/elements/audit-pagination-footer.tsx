/** Audit pagination: the range on the left; page size and page movement on the right. */

import { HStack, IconButton, NativeSelect, Text } from "@langwatch/design-system/primitives";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const AUDIT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250] as const;

export function AuditPaginationFooter({
  totalHits,
  pageOffset,
  pageSize,
  nextPage,
  prevPage,
  changePageSize,
}: {
  totalHits: number;
  pageOffset: number;
  pageSize: number;
  nextPage: () => void;
  prevPage: () => void;
  changePageSize: (size: number) => void;
}) {
  if (totalHits === 0 && pageOffset === 0) return null;
  const first = Math.min(pageOffset + 1, totalHits);
  const last = Math.min(pageOffset + pageSize, totalHits);

  return (
    <HStack width="full" justify="space-between" gap={4} paddingY={2} fontSize="13px">
      <Text color="fg.muted" fontVariantNumeric="tabular-nums">
        {`${first}–${last} of ${totalHits} ${totalHits === 1 ? "event" : "events"}`}
      </Text>
      <HStack gap={2}>
        <Text color="fg.muted" flexShrink={0}>
          Per page
        </Text>
        <NativeSelect.Root size="sm" width="auto">
          <NativeSelect.Field
            aria-label="Items per page"
            height="8"
            value={pageSize.toString()}
            onChange={(event) => changePageSize(parseInt(event.target.value, 10))}
          >
            {AUDIT_PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size.toString()}>
                {size}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <IconButton
          variant="outline"
          size="sm"
          boxSize="8"
          minWidth="8"
          onClick={prevPage}
          disabled={pageOffset === 0}
          aria-label="Go to previous page"
          title="Go to previous page"
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          variant="outline"
          size="sm"
          boxSize="8"
          minWidth="8"
          onClick={nextPage}
          disabled={pageOffset + pageSize >= totalHits}
          aria-label="Go to next page"
          title="Go to next page"
        >
          <ChevronRight />
        </IconButton>
      </HStack>
    </HStack>
  );
}
