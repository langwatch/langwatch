import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "react-feather";

interface PaginationFooterProps {
  totalCount: number;
  pageOffset: number;
  pageSize: number;
  nextPage: () => void;
  prevPage: () => void;
  changePageSize: (size: number) => void;
  padding?: number;
  pageSizeOptions?: number[];
  label?: string;
}

export function PaginationFooter({
  totalCount,
  pageOffset,
  pageSize,
  nextPage,
  prevPage,
  changePageSize,
  padding = 6,
  pageSizeOptions = [10, 25, 50, 100],
  label = "Items per page",
}: PaginationFooterProps) {
  return (
    <HStack
      padding={padding}
      gap={2}
      minHeight="60px" // Prevent height changes
      align="center"
    >
      <Field.Root>
        <HStack gap={3}>
          <Field.Label flexShrink={0}>{label}</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              defaultValue="25"
              onChange={(e) => changePageSize(parseInt(e.target.value))}
              borderColor="black"
              borderRadius="lg"
              value={pageSize.toString()}
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      </Field.Root>

      <HStack gap={3}>
        <Text flexShrink={0}>
          {`${pageOffset + 1}`} -{" "}
          {`${
            pageOffset + pageSize > totalCount
              ? totalCount
              : pageOffset + pageSize
          }`}{" "}
          of {`${totalCount}`} items
        </Text>
        <HStack gap={0}>
          <Button
            variant="ghost"
            padding={0}
            onClick={prevPage}
            disabled={pageOffset === 0}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            padding={0}
            disabled={pageOffset + pageSize >= totalCount}
            onClick={nextPage}
          >
            <ChevronRight />
          </Button>
        </HStack>
      </HStack>
    </HStack>
  );
}
