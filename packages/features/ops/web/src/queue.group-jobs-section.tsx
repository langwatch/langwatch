import { Button, HStack, Input, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import type { OpsQueueJob as JobEntry } from "@langwatch/ops-contract";
import { GroupJobCard } from "./queue.group-job-card";
import { jobMatchesFilter } from "./queue.job-context";

function JobsPager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <HStack gap={1}>
      <Button
        size="2xs"
        variant="outline"
        aria-label="Previous jobs page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <Button
        size="2xs"
        variant="outline"
        aria-label="Next jobs page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </HStack>
  );
}

function JobsList({
  visible,
  total,
  filter,
  now,
  traceUrlForTraceId,
}: {
  visible: JobEntry[];
  total: number;
  filter: string;
  now: number;
  traceUrlForTraceId?: (traceId: string) => string | null;
}) {
  if (visible.length > 0) {
    return (
      <VStack align="stretch" gap={2}>
        {visible.map((job) => (
          <GroupJobCard
            key={job.jobId}
            job={job}
            now={now}
            traceUrlForTraceId={traceUrlForTraceId}
          />
        ))}
      </VStack>
    );
  }
  return (
    <Text textStyle="xs" color="fg.muted">
      {total > 0 && filter.trim()
        ? "No jobs on this page match the filter."
        : "No jobs in queue."}
    </Text>
  );
}

export function GroupJobsSection({
  jobs,
  jobsLoading,
  now,
  page,
  pageSize,
  onPageChange,
  filter,
  onFilterChange,
  traceUrlForTraceId,
}: {
  jobs: { jobs: JobEntry[]; total: number } | null;
  jobsLoading: boolean;
  now: number;
  page: number;
  pageSize: number;
  onPageChange?: (page: number) => void;
  filter: string;
  onFilterChange?: (filter: string) => void;
  traceUrlForTraceId?: (traceId: string) => string | null;
}) {
  const total = jobs?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const visible = (jobs?.jobs ?? []).filter((job) => jobMatchesFilter(job, filter));

  return (
    <VStack align="stretch" gap={1.5}>
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted" flexShrink={0}>
          Jobs {total > 0 ? `(${first}–${last} of ${total})` : "(0)"}
        </Text>
        <Spacer />
        {onFilterChange && total > 0 && (
          <Input
            size="2xs"
            width="180px"
            placeholder="Filter this page..."
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
          />
        )}
        {onPageChange && pageCount > 1 && (
          <JobsPager page={page} pageCount={pageCount} onPageChange={onPageChange} />
        )}
      </HStack>

      {jobsLoading ? (
        <Spinner size="xs" />
      ) : (
        <JobsList
          visible={visible}
          total={total}
          filter={filter}
          now={now}
          traceUrlForTraceId={traceUrlForTraceId}
        />
      )}
    </VStack>
  );
}
