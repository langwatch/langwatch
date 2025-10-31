import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { PaginationFooter } from "../ui/PaginationFooter";

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
      if (traceGroups.isFetched && traceGroups.data?.totalHits !== undefined) {
        const newTotalHits: number = traceGroups.data.totalHits;

        // Only update if the value actually changed to prevent unnecessary re-renders
        if (newTotalHits !== totalHits) {
          setTotalHits(newTotalHits);
        }
      }
    }, [traceGroups.data?.totalHits, traceGroups.isFetched]);
  };

  useEffect(() => {
    const hasPageOffset = router.query.pageOffset !== undefined;
    const hasPageSize = router.query.pageSize !== undefined;

    if (!hasPageOffset || !hasPageSize) {
      void router.replace(
        {
          pathname: router.pathname,
          query: { ...router.query, pageOffset: "0", pageSize: "25" },
        },
        undefined,
        { shallow: true }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.pathname, router.query.query]);

  return {
    totalHits,
    pageOffset,
    pageSize,
    nextPage,
    prevPage,
    changePageSize,
    useUpdateTotalHits,
    // Add a flag to indicate if we have stable data
    hasStableData: totalHits > 0,
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
    <PaginationFooter
      totalCount={totalHits}
      pageOffset={pageOffset}
      pageSize={pageSize}
      nextPage={nextPage}
      prevPage={prevPage}
      changePageSize={changePageSize}
      padding={6}
      pageSizeOptions={[10, 25, 50, 100, 250]}
      label="Items per page "
    />
  );
}
