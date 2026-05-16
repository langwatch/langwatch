import { Button, Flex, IconButton, Skeleton, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { useFilterStore } from "../../stores/filterStore";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

interface PaginationProps {
  totalHits: number;
  /**
   * Renders a placeholder bar in place of the rows-per-page selector +
   * "Page X of Y" copy while data is loading, so the pagination row
   * doesn't pop in when the first page resolves. Back/forward arrows
   * keep rendering — their disabled state doesn't change between
   * loading and loaded for the initial page, and they anchor the
   * visual end of the row.
   */
  isLoading?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({
  totalHits,
  isLoading = false,
}) => {
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const setPage = useFilterStore((s) => s.setPage);
  const setPageSize = useFilterStore((s) => s.setPageSize);

  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));

  if (!isLoading && totalHits === 0) return null;

  return (
    <Flex
      align="center"
      justify="flex-end"
      gap={3}
      paddingX={2}
      paddingY={1.5}
      borderTopWidth="1px"
      borderColor="border.muted"
      bg="bg.surface"
      flexShrink={0}
    >
      {isLoading ? (
        <Skeleton height="14px" width="240px" borderRadius="sm" />
      ) : (
        <>
          <Flex align="center" gap={0.5}>
            <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
              Rows
            </Text>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <Button
                key={size}
                variant="ghost"
                size="2xs"
                color={pageSize === size ? "fg" : "fg.subtle"}
                fontWeight={pageSize === size ? "semibold" : "normal"}
                onClick={() => setPageSize(size)}
                paddingX={1.5}
                minWidth="auto"
              >
                {size}
              </Button>
            ))}
          </Flex>
          <Text textStyle="xs" color="fg.subtle">
            Page {page} of {totalPages} ({totalHits} traces)
          </Text>
        </>
      )}
      <Flex gap={1}>
        <IconButton
          aria-label="Previous page"
          variant="ghost"
          size="xs"
          disabled={isLoading || page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={12} />
        </IconButton>
        <IconButton
          aria-label="Next page"
          variant="ghost"
          size="xs"
          disabled={isLoading || page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={12} />
        </IconButton>
      </Flex>
    </Flex>
  );
};
