import {
  Badge,
  Box,
  Card,
  Center,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatTimeAgo } from "@langwatch/ops-web";
import type { GroupInfo, OpsQueueJob as JobEntry } from "@langwatch/ops-contract";
import type { GrafanaDeepLinkConfig } from "~/utils/grafanaLinks";
import { GroupStateBadge } from "../GroupStateBadge";
import {
  classifyGroup,
  describeNextRun,
  type GroupClassification,
} from "../pipelineUtils";
import { GroupJobsSection } from "./GroupJobsSection";

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack align="start" gap={0}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

function GroupStatusRow({
  detail,
  c,
  now,
}: {
  detail: GroupInfo;
  c: GroupClassification;
  now: number;
}) {
  return (
    <HStack gap={4} flexWrap="wrap">
      <DetailField label="Status">
        <GroupStateBadge c={c} />
      </DetailField>
      <DetailField label="Pipeline">
        <Text textStyle="sm">{detail.pipelineName ?? "—"}</Text>
      </DetailField>
      <DetailField label="Pending">
        <Text textStyle="sm" fontFamily="mono">
          {detail.pendingJobs}
        </Text>
      </DetailField>
      {c.attempt > 0 && (
        <DetailField label="Attempts">
          <Text textStyle="sm" fontFamily="mono" color="orange.500">
            {c.attempt}
          </Text>
        </DetailField>
      )}
      <DetailField label="Next run">
        <Text textStyle="sm" color={c.state === "retrying" ? "orange.500" : undefined}>
          {describeNextRun(c, now)}
        </Text>
      </DetailField>
      {detail.activeJobId && (
        <DetailField label="Active Job">
          <Text textStyle="xs" fontFamily="mono" color="green.500">
            {detail.activeJobId}
          </Text>
        </DetailField>
      )}
    </HStack>
  );
}

function GroupTimingRow({ detail, now }: { detail: GroupInfo; now: number }) {
  return (
    <HStack gap={4}>
      <DetailField label="Oldest Job">
        <Text textStyle="sm">{formatTimeAgo(detail.oldestJobMs, now)}</Text>
      </DetailField>
      <DetailField label="Newest Job">
        <Text textStyle="sm">{formatTimeAgo(detail.newestJobMs, now)}</Text>
      </DetailField>
      {detail.processingDurationMs != null && (
        <DetailField label="Processing">
          <Text textStyle="sm">{detail.processingDurationMs}ms</Text>
        </DetailField>
      )}
      {detail.activeKeyTtlSec != null && (
        <DetailField label="Worker lease">
          <Text textStyle="sm">expires in {detail.activeKeyTtlSec}s</Text>
        </DetailField>
      )}
    </HStack>
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
      <Card.Root borderColor="red.500/20">
        <Card.Body padding={3}>
          <Text
            textStyle="xs"
            color="red.500"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {detail.errorMessage}
          </Text>
          {detail.errorStack && (
            <Box
              marginTop={2}
              maxHeight="200px"
              overflow="auto"
              bg="bg.subtle"
              borderRadius="sm"
              padding={2}
            >
              <Text
                textStyle="xs"
                fontFamily="mono"
                color="fg.muted"
                whiteSpace="pre"
                fontSize="10px"
              >
                {detail.errorStack}
              </Text>
            </Box>
          )}
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

/**
 * The drawer body, separated from the queries so it can be rendered (and
 * tested) against plain data. `now` is injectable for the same reason the
 * table pins it to the fetch instant: countdowns must be derived from a fixed
 * point, not from whenever the component happens to re-render.
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
  grafana,
  now = Date.now(),
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
  grafana?: GrafanaDeepLinkConfig | null;
  now?: number;
}) {
  if (isLoading) {
    return (
      <Center paddingY={6}>
        <Spinner size="sm" />
      </Center>
    );
  }

  if (!detail) {
    return (
      <Text textStyle="sm" color="fg.muted" data-testid="group-detail-missing">
        This group no longer exists — its jobs completed and it was cleaned up, or it was
        drained. The table refreshes every few seconds, so a finished group can linger
        there briefly.
      </Text>
    );
  }

  const c = classifyGroup(detail, now);

  return (
    <VStack align="stretch" gap={4}>
      <GroupStatusRow detail={detail} c={c} now={now} />
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
        grafana={grafana}
      />
    </VStack>
  );
}
