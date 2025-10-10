import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export const useEvaluationsPagination = () => {
  const router = useRouter();
  const [totalCount, setTotalCount] = useState<number>(0);

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

  const updateTotalCount = (count: number) => {
    setTotalCount(count);
  };

  return {
    pageOffset,
    pageSize,
    totalCount,
    nextPage,
    prevPage,
    changePageSize,
    updateTotalCount,
  };
};
