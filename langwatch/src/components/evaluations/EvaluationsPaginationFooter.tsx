import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
import { ChevronLeft, ChevronRight } from "react-feather";

interface EvaluationsPaginationFooterProps {
  totalCount: number;
  pageOffset: number;
  pageSize: number;
  nextPage: () => void;
  prevPage: () => void;
  changePageSize: (size: number) => void;
}

export function EvaluationsPaginationFooter({
  totalCount,
  pageOffset,
  pageSize,
  nextPage,
  prevPage,
  changePageSize,
}: EvaluationsPaginationFooterProps) {
  return (
    <HStack padding={4} gap={2}>
      <Field.Root>
        <HStack gap={3}>
          <Field.Label flexShrink={0}>Items per page</Field.Label>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              defaultValue="25"
              onChange={(e) => changePageSize(parseInt(e.target.value))}
              borderColor="black"
              borderRadius="lg"
              value={pageSize.toString()}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
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
