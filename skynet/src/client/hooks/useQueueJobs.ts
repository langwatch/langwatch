import { useState, useEffect, useCallback, useRef } from "react";
import type { BullMQJobsPage, BullMQJobState } from "../../shared/types.ts";
import { apiFetch } from "./useApi.ts";

export function useQueueJobs(queueName: string, state: BullMQJobState, refreshInterval = 10_000) {
  const [data, setData] = useState<BullMQJobsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const pageRef = useRef(0);
  const [page, setPageState] = useState(0);

  const fetchJobs = useCallback(
    async (p = 0) => {
      setLoading(true);
      try {
        const encoded = encodeURIComponent(queueName);
        const result = await apiFetch<BullMQJobsPage>(
          `/api/bullmq/queues/${encoded}/jobs?state=${state}&page=${p}`,
        );
        setData(result);
        pageRef.current = p;
        setPageState(p);
      } finally {
        setLoading(false);
      }
    },
    [queueName, state],
  );

  // Reset data and page when state or queue changes
  useEffect(() => {
    setData(null);
    pageRef.current = 0;
    setPageState(0);
    fetchJobs(0);
    const interval = setInterval(() => fetchJobs(pageRef.current), refreshInterval);
    return () => clearInterval(interval);
  }, [fetchJobs, refreshInterval]);

  return { data, loading, page, setPage: (p: number) => fetchJobs(p), refresh: () => fetchJobs(pageRef.current) };
}
