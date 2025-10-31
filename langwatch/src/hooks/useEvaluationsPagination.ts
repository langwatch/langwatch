import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

export const useEvaluationsPagination = () => {
  const router = useRouter();
  const [totalCount, setTotalCount] = useState<number>(0);

  // Get pagination from URL parameters with defaults
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize = parseInt(router.query.pageSize as string) || 25;

  const nextPage = () => {
    const newOffset = pageOffset + pageSize;
    router
      .push({
        pathname: router.pathname,
        query: { ...router.query, pageOffset: newOffset.toString() },
      })
      .catch((error) => {
        Sentry.captureException(error, {
          tags: { component: "useEvaluationsPagination", action: "nextPage" },
        });
      });
  };

  const prevPage = () => {
    if (pageOffset > 0) {
      const newOffset = pageOffset - pageSize;
      router
        .push({
          pathname: router.pathname,
          query: { ...router.query, pageOffset: newOffset.toString() },
        })
        .catch((error) => {
          Sentry.captureException(error, {
            tags: { component: "useEvaluationsPagination", action: "prevPage" },
          });
        });
    }
  };

  const changePageSize = (size: number) => {
    router
      .push({
        pathname: router.pathname,
        query: { ...router.query, pageSize: size.toString(), pageOffset: "0" },
      })
      .catch((error) => {
        Sentry.captureException(error, {
          tags: {
            component: "useEvaluationsPagination",
            action: "changePageSize",
          },
        });
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
