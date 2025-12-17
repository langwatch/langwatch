import { Button, Flex, HStack, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface DataGridPaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

/**
 * Pagination controls for the DataGrid
 */
export function DataGridPagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
}: DataGridPaginationProps) {
  const totalPages = Math.ceil(totalCount / pageSize);
  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalCount);

  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (page > 3) {
        pages.push("...");
      }

      // Show pages around current
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (page < totalPages - 2) {
        pages.push("...");
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <Flex
      align="center"
      justify="space-between"
      py={3}
      px={4}
      borderTop="1px solid"
      borderColor="gray.200"
    >
      {/* Results info */}
      <Text fontSize="sm" color="gray.600">
        Showing {startItem}-{endItem} of {totalCount} results
      </Text>

      {/* Page size selector */}
      <HStack gap={2}>
        <Text fontSize="sm" color="gray.600">
          Rows per page:
        </Text>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{
            padding: "4px 8px",
            borderRadius: "4px",
            border: "1px solid var(--chakra-colors-gray-200)",
            fontSize: "14px",
          }}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </HStack>

      {/* Page navigation */}
      <HStack gap={1}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrevious}
        >
          <ChevronLeft size={16} />
        </Button>

        {getPageNumbers().map((pageNum, index) =>
          pageNum === "..." ? (
            <Text key={`ellipsis-${index}`} px={2} color="gray.400">
              ...
            </Text>
          ) : (
            <Button
              key={pageNum}
              size="sm"
              variant={pageNum === page ? "solid" : "ghost"}
              colorPalette={pageNum === page ? "blue" : undefined}
              onClick={() => onPageChange(pageNum)}
              minW="32px"
            >
              {pageNum}
            </Button>
          )
        )}

        <Button
          size="sm"
          variant="ghost"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
        >
          <ChevronRight size={16} />
        </Button>
      </HStack>
    </Flex>
  );
}
