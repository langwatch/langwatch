import { CodePreview } from "@langwatch/design-system/code-preview";
import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import { Badge, Alert, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import type { GroupInfo, OpsQueueJob as JobEntry } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import {
  classifyGroup,
  describeNextRun,
  type GroupClassification,
} from "../../model/queue-pipeline-utils.ts";
import { GroupJobsSection } from "../blocks/queue-group-jobs-section.tsx";
import { GroupStateBadge } from "../elements/queue-group-state-badge.tsx";

function GroupStatusRow({
  detail,
  classification,
  now,
}: {
  detail: GroupInfo;
  classification: GroupClassification;
  now: number;
}) {
  return (
    <SummaryList>
      <SummaryListItem label="Status">
        <GroupStateBadge c={classification} />
      </SummaryListItem>
      <SummaryListItem label="Pipeline">
        <Text textStyle="sm">{detail.pipelineName ?? "—"}</Text>
      </SummaryListItem>
      <SummaryListItem label="Pending">
        <Text textStyle="sm" fontFamily="mono">
          {detail.pendingJobs}
        </Text>
      </SummaryListItem>
      {classification.attempt > 0 && (
        <SummaryListItem label="Attempts">
          <Text textStyle="sm" fontFamily="mono" color="fg.warning">
            {classification.attempt}
          </Text>
        </SummaryListItem>
      )}
      <SummaryListItem label="Next run">
        <Text textStyle="sm" color={classification.state === "retrying" ? "fg.warning" : undefined}>
          {describeNextRun(classification, now)}
        </Text>
      </SummaryListItem>
      {detail.activeJobId && (
        <SummaryListItem label="Active Job">
          <Text textStyle="xs" fontFamily="mono" color="green.fg">
            {detail.activeJobId}
          </Text>
        </SummaryListItem>
      )}
    </SummaryList>
  );
}

function GroupTimingRow({ detail, now }: { detail: GroupInfo; now: number }) {
  return (
    <SummaryList>
      <SummaryListItem label="Oldest Job">
        <Text textStyle="sm">{formatTimeAgo(detail.oldestJobMs, now)}</Text>
      </SummaryListItem>
      <SummaryListItem label="Newest Job">
        <Text textStyle="sm">{formatTimeAgo(detail.newestJobMs, now)}</Text>
      </SummaryListItem>
      {detail.processingDurationMs != null && (
        <SummaryListItem label="Processing">
          <Text textStyle="sm">{detail.processingDurationMs}ms</Text>
        </SummaryListItem>
      )}
      {detail.activeKeyTtlSec != null && (
        <SummaryListItem label="Worker lease">
          <Text textStyle="sm">expires in {detail.activeKeyTtlSec}s</Text>
        </SummaryListItem>
      )}
    </SummaryList>
  );
}

function GroupErrorSection({ detail, now }: { detail: GroupInfo; now: number }) {
  if (!detail.errorMessage) return null;
  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Last error
        </Text>
        {detail.errorTimestamp !== null && (
          <Badge size="xs" colorPalette="red" variant="subtle">
            {formatTimeAgo(detail.errorTimestamp, now)}
          </Badge>
        )}
      </HStack>
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Description whiteSpace="pre-wrap" overflowWrap="anywhere">
            {detail.errorMessage}
          </Alert.Description>
          {detail.errorStack && (
            <CodePreview
              code={detail.errorStack}
              language="text"
              filename="Stack trace"
              compact
              maxHeight="200px"
            />
          )}
        </Alert.Content>
      </Alert.Root>
    </VStack>
  );
}

/**
 * The drawer body, separated from the queries so it can be rendered (and
 * tested) against plain data. `now` is injectable for the same reason the
 * table pins it: countdowns derive from a fixed point, not from re-render.
 */
export function GroupDetailContent({
  detail,
  isLoading,
  jobs,
  jobsLoading,
  jobsPage = 1,
  jobsPageSize = 20,
  onJobsPageChange,
  jobFilter = "",
  onJobFilterChange,
  traceUrlForTraceId,
  now = nowInstant().epochMilliseconds,
}: {
  detail: GroupInfo | null;
  isLoading: boolean;
  jobs: { jobs: JobEntry[]; total: number } | null;
  jobsLoading: boolean;
  jobsPage?: number;
  jobsPageSize?: number;
  onJobsPageChange?: (page: number) => void;
  jobFilter?: string;
  onJobFilterChange?: (filter: string) => void;
  traceUrlForTraceId?: (traceId: string) => string | null;
  now?: number;
}) {
  if (isLoading) {
    return <ListPageSkeleton label="Loading group details" />;
  }

  if (!detail) {
    return (
      <Text textStyle="sm" color="fg.muted" data-testid="group-detail-missing">
        This group no longer exists. Its jobs completed and it was cleaned up, or it was drained.
        The table refreshes every few seconds, so a finished group can linger there briefly.
      </Text>
    );
  }

  const classification = classifyGroup(detail, now);

  return (
    <VStack align="stretch" gap={4}>
      <GroupStatusRow detail={detail} classification={classification} now={now} />
      <GroupTimingRow detail={detail} now={now} />
      <GroupErrorSection detail={detail} now={now} />
      <GroupJobsSection
        jobs={jobs}
        jobsLoading={jobsLoading}
        now={now}
        page={jobsPage}
        pageSize={jobsPageSize}
        onPageChange={onJobsPageChange}
        filter={jobFilter}
        onFilterChange={onJobFilterChange}
        traceUrlForTraceId={traceUrlForTraceId}
      />
    </VStack>
  );
}
