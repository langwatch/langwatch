import { useState, useEffect, useCallback } from "react";
import type { GroupDetailData, JobInfo, BullMQJob } from "../../shared/types.ts";
import { apiFetch } from "./useApi.ts";
import { JOBS_PAGE_SIZE } from "../../shared/constants.ts";

interface JobsPage {
  jobs: JobInfo[];
  total: number;
  page: number;
  totalPages: number;
}

interface GroupResponse extends GroupDetailData {
  status?: "completed";
  completedJobs?: BullMQJob[];
}

export function useGroupDetail(groupId: string, queueName?: string) {
  const [group, setGroup] = useState<GroupDetailData | null>(null);
  const [jobsPage, setJobsPage] = useState<JobsPage | null>(null);
  const [completedJobs, setCompletedJobs] = useState<BullMQJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const fetchGroup = useCallback(async () => {
    try {
      const qs = queueName ? `?queue=${encodeURIComponent(queueName)}` : "";
      const data = await apiFetch<GroupResponse>(`/api/groups/${encodeURIComponent(groupId)}${qs}`);

      if (data.status === "completed") {
        setIsCompleted(true);
        setCompletedJobs(data.completedJobs ?? []);
        setGroup(data);
        setError(null);
      } else {
        setGroup(data);
        setError(null);
        setIsCompleted(false);
        setCompletedJobs([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("404")) {
        setIsCompleted(true);
        setError(null);
      } else {
        setError(message);
      }
    }
  }, [groupId, queueName]);

  const fetchJobs = useCallback(async (page = 0) => {
    if (!queueName) return;
    try {
      const data = await apiFetch<JobsPage>(
        `/api/groups/${encodeURIComponent(groupId)}/jobs?queue=${encodeURIComponent(queueName)}&page=${page}`,
      );
      setJobsPage(data);
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    }
  }, [groupId, queueName]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchGroup(), fetchJobs(0)]).finally(() => setLoading(false));

    const interval = setInterval(fetchGroup, 5000);
    return () => clearInterval(interval);
  }, [fetchGroup, fetchJobs]);

  return { group, jobsPage, completedJobs, loading, error, isCompleted, fetchJobs };
}
