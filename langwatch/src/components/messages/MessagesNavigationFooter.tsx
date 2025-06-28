import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "react-feather";

import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/api/root";

export const useMessagesNavigationFooter = () => {
  const router = useRouter();

  const [totalHits, setTotalHits] = useState<number>(0);

  // Get pagination from URL parameters with defaults
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize = parseInt(router.query.pageSize as string) || 25;

  const nextPage = () => {
    const newOffset = pageOffset + pageSize;
    void router.push({
      pathname: router.pathname,
      query: { ...router.query, pageOffset: newOffset.toString() },
    });
  };

  const prevPage = () => {
    if (pageOffset > 0) {
      const newOffset = pageOffset - pageSize;
      void router.push({
        pathname: router.pathname,
        query: { ...router.query, pageOffset: newOffset.toString() },
      });
    }
  };

  const changePageSize = (size: number) => {
    void router.push({
      pathname: router.pathname,
      query: { ...router.query, pageSize: size.toString(), pageOffset: "0" },
    });
  };

  const useUpdateTotalHits = (
    traceGroups: UseTRPCQueryResult<
      inferRouterOutputs<AppRouter>["traces"]["getAllForProject"],
      TRPCClientErrorLike<AppRouter>
    >
  ) => {
    useEffect(() => {
      if (traceGroups.isFetched) {
        const totalHits: number = traceGroups.data?.totalHits ?? 0;

        setTotalHits(totalHits);
      }
    }, [traceGroups.data?.totalHits, traceGroups.isFetched]);
  };

  useEffect(() => {
    void router.push({
      pathname: router.pathname,
      query: { ...router.query, pageOffset: "0", pageSize: "25" },
    });
  }, [router.query.query]);

  return {
    totalHits,
    pageOffset,
    pageSize,
    nextPage,
    prevPage,
    changePageSize,
    useUpdateTotalHits,
  };
};

export function MessagesNavigationFooter({
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
  return (
    <HStack padding={6} gap={2}>
      <Field.Root>
        <HStack gap={3}>
          <Field.Label flexShrink={0}>Items per page </Field.Label>

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
              <option value="250">250</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      </Field.Root>

      <HStack gap={3}>
        <Text flexShrink={0}>
          {" "}
          {`${pageOffset + 1}`} -{" "}
          {`${
            pageOffset + pageSize > totalHits
              ? totalHits
              : pageOffset + pageSize
          }`}{" "}
          of {`${totalHits}`} items
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
            disabled={pageOffset + pageSize >= totalHits}
            onClick={nextPage}
          >
            <ChevronRight />
          </Button>
        </HStack>
      </HStack>
    </HStack>
  );
}
