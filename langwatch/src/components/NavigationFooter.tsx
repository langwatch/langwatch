import { Button, Field, HStack, NativeSelect, Text } from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "react-feather";
import type { AppRouter } from "../server/api/root";

export const useNavigationFooter = () => {
  const router = useRouter();

  const [totalHits, setTotalHits] = useState<number>(0);

  // Get pagination from URL parameters with defaults
  const pageOffset = router.isReady
    ? parseInt(router.query.pageOffset as string) || 0
    : 0;
  const pageSize = router.isReady
    ? parseInt(router.query.pageSize as string) || 25
    : 25;

  const nextPage = () => {
    if (!router.isReady) return;
    const newOffset = pageOffset + pageSize;
    const newQuery = {
      ...Object.fromEntries(
        Object.entries(router.query).filter(([_, v]) => v !== undefined),
      ),
      pageOffset: newOffset.toString(),
    };
    void router.replace(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const prevPage = () => {
    if (!router.isReady || pageOffset === 0) return;
    const newOffset = Math.max(0, pageOffset - pageSize);
    const newQuery = {
      ...Object.fromEntries(
        Object.entries(router.query).filter(([_, v]) => v !== undefined),
      ),
      pageOffset: newOffset.toString(),
    };
    void router.replace(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const changePageSize = (size: number) => {
    if (!router.isReady) return;
    const newQuery = {
      ...Object.fromEntries(
        Object.entries(router.query).filter(([_, v]) => v !== undefined),
      ),
      pageSize: size.toString(),
      pageOffset: "0",
    };
    void router.replace(
      {
        pathname: router.pathname,
        query: newQuery,
      },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const useUpdateTotalHits = <T extends { totalHits?: number }>(
    queryResult: UseTRPCQueryResult<T, TRPCClientErrorLike<AppRouter>>,
  ) => {
    useEffect(() => {
      if (queryResult.isFetched) {
        const totalHits: number = queryResult.data?.totalHits ?? 0;

        setTotalHits(totalHits);
      }
    }, [queryResult.data?.totalHits, queryResult.isFetched]);
  };

  useEffect(() => {
    // Only reset pagination when search query changes (for messages page)
    // Skip if query parameter doesn't exist (evaluations page)
    if (router.query.query !== undefined) {
      void router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, pageOffset: "0", pageSize: "25" },
        },
        undefined,
        { shallow: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export function NavigationFooter({
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
              onChange={(e) => {
                e.preventDefault();
                changePageSize(parseInt(e.target.value));
              }}
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

      <HStack gap={3} paddingRight={3}>
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
            type="button"
            variant="ghost"
            padding={0}
            onClick={(e) => {
              e.preventDefault();
              prevPage();
            }}
            disabled={pageOffset === 0}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            padding={0}
            disabled={pageOffset + pageSize >= totalHits}
            onClick={(e) => {
              e.preventDefault();
              nextPage();
            }}
          >
            <ChevronRight />
          </Button>
        </HStack>
      </HStack>
    </HStack>
  );
}
