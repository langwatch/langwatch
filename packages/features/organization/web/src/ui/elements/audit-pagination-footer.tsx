/**
 * How the audit table walks its pages.
 *
 * A NARROWED FAMILY-LOCAL COPY of `platform/app/src/components/NavigationFooter.tsx`,
 * which is 443 lines and has a second caller — the experiments list — so it
 * stays where it is. What did not travel is everything that module carries for
 * TRACE SEARCH: the cursor mode, the walked-cursor stack, the base64 scroll id
 * and the tRPC total-hits hook. The audit trail is a Prisma read with `skip`,
 * pages by real offsets, and drove that component from its own state anyway —
 * the platform footer's own docblock says so.
 *
 * What survives is the part a reader sees: how many items there are, where in
 * them they are, and the two ways to move.
 */

import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
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

  return (
    <HStack padding={6} gap={2}>
      <Field.Root>
        <HStack gap={3}>
          <Field.Label flexShrink={0}>Items per page</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              aria-label="Items per page"
              value={pageSize.toString()}
              onChange={(event) => changePageSize(parseInt(event.target.value, 10))}
              borderRadius="lg"
            >
              {AUDIT_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size.toString()}>
                  {size}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      </Field.Root>

      <HStack gap={3} paddingRight={3}>
        <Text flexShrink={0}>
          {`${pageOffset + 1}-${Math.min(pageOffset + pageSize, totalHits)} of ${totalHits} items`}
        </Text>
        <HStack gap={0}>
          <Button
            variant="ghost"
            padding={0}
            onClick={prevPage}
            disabled={pageOffset === 0}
            aria-label="Go to previous page"
            title="Go to previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            padding={0}
            onClick={nextPage}
            disabled={pageOffset + pageSize >= totalHits}
            aria-label="Go to next page"
            title="Go to next page"
          >
            <ChevronRight />
          </Button>
        </HStack>
      </HStack>
    </HStack>
  );
}
