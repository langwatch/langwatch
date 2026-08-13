import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { Dialog } from "~/components/ui/dialog";
import type { JobEntry } from "~/server/app-layer/ops/repositories/queue.repository";
import type { GroupInfo } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import { GroupStateBadge } from "./GroupStateBadge";
import {
  classifyGroup,
  describeNextRun,
  type GroupClassification,
} from "./pipelineUtils";

type GroupTarget = { queueName: string; groupId: string };

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
        <Text
          textStyle="sm"
          color={c.state === "retrying" ? "orange.500" : undefined}
        >
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

function GroupErrorSection({
  detail,
  now,
}: {
  detail: GroupInfo;
  now: number;
}) {
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

function GroupJobCard({ job, now }: { job: JobEntry; now: number }) {
  return (
    <Card.Root variant="outline">
      <Card.Body padding={3}>
        <HStack gap={3} marginBottom={job.data ? 2 : 0}>
          <DetailField label="Job ID">
            <Text textStyle="xs" fontFamily="mono" wordBreak="break-all">
              {job.jobId}
            </Text>
          </DetailField>
          <DetailField label="Runs at">
            <Text textStyle="xs" fontFamily="mono">
              {formatTimeAgo(job.score, now)}
            </Text>
          </DetailField>
        </HStack>
        {job.data && (
          <Box
            bg="bg.subtle"
            borderRadius="sm"
            padding={2}
            maxHeight="200px"
            overflow="auto"
          >
            <Text
              as="pre"
              textStyle="xs"
              fontFamily="mono"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              fontSize="11px"
            >
              {JSON.stringify(job.data, null, 2)}
            </Text>
          </Box>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function GroupJobsSection({
  jobs,
  jobsLoading,
  now,
}: {
  jobs: { jobs: JobEntry[]; total: number } | null;
  jobsLoading: boolean;
  now: number;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="xs" color="fg.muted">
        Jobs {jobs ? `(${jobs.total})` : ""}
      </Text>
      {jobsLoading ? (
        <Spinner size="xs" />
      ) : jobs && jobs.jobs.length > 0 ? (
        <VStack align="stretch" gap={2}>
          {jobs.jobs.map((job) => (
            <GroupJobCard key={job.jobId} job={job} now={now} />
          ))}
        </VStack>
      ) : (
        <Text textStyle="xs" color="fg.muted">
          No jobs in queue.
        </Text>
      )}
    </VStack>
  );
}

/**
 * The dialog body, separated from the queries so it can be rendered (and
 * tested) against plain data. `now` is injectable for the same reason the
 * table pins it to the fetch instant: countdowns must be derived from a fixed
 * point, not from whenever the component happens to re-render.
 */
export function GroupDetailContent({
  detail,
  isLoading,
  jobs,
  jobsLoading,
  now = Date.now(),
}: {
  detail: GroupInfo | null;
  isLoading: boolean;
  jobs: { jobs: JobEntry[]; total: number } | null;
  jobsLoading: boolean;
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
        This group no longer exists — its jobs completed and it was cleaned up,
        or it was drained. The table refreshes every few seconds, so a finished
        group can linger there briefly.
      </Text>
    );
  }

  const c = classifyGroup(detail, now);

  return (
    <VStack align="stretch" gap={4}>
      <GroupStatusRow detail={detail} c={c} now={now} />
      <GroupTimingRow detail={detail} now={now} />
      <GroupErrorSection detail={detail} now={now} />
      <GroupJobsSection jobs={jobs} jobsLoading={jobsLoading} now={now} />
    </VStack>
  );
}

function GroupDetailFooter({
  group,
  showRetry,
  onRetry,
  retryLoading,
  onDrain,
}: {
  group: GroupTarget;
  showRetry: boolean;
  onRetry?: (target: GroupTarget) => void;
  retryLoading?: boolean;
  onDrain?: (target: GroupTarget) => void;
}) {
  return (
    <Dialog.Footer>
      {showRetry && onRetry && (
        <Button
          variant="outline"
          size="sm"
          colorPalette="green"
          loading={retryLoading}
          onClick={() => onRetry(group)}
        >
          Retry now
        </Button>
      )}
      {onDrain && (
        <Button
          variant="outline"
          size="sm"
          colorPalette="red"
          onClick={() => onDrain(group)}
        >
          Drain
        </Button>
      )}
    </Dialog.Footer>
  );
}

export function GroupDetailDialog({
  group,
  onClose,
  onRetry,
  retryLoading,
  onDrain,
}: {
  group: GroupTarget | null;
  onClose: () => void;
  /** Present only when the operator may mutate; gates the footer entirely. */
  onRetry?: (target: GroupTarget) => void;
  retryLoading?: boolean;
  onDrain?: (target: GroupTarget) => void;
}) {
  const detailQuery = api.ops.getGroupDetail.useQuery(
    { queueName: group?.queueName ?? "", groupId: group?.groupId ?? "" },
    { enabled: !!group },
  );
  const jobsQuery = api.ops.getGroupJobs.useQuery(
    {
      queueName: group?.queueName ?? "",
      groupId: group?.groupId ?? "",
      page: 1,
      pageSize: 20,
    },
    { enabled: !!group },
  );

  const detail = detailQuery.data ?? null;
  const jobs = jobsQuery.data ?? null;
  const showRetry = !!onRetry && !!detail?.isBlocked;
  const showFooter = !!detail && !!group && (showRetry || !!onDrain);

  return (
    <Dialog.Root
      open={!!group}
      onOpenChange={(e) => !e.open && onClose()}
      size="lg"
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>
            <Text textStyle="sm" fontFamily="mono" wordBreak="break-all">
              {group?.groupId}
            </Text>
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <GroupDetailContent
            detail={detail}
            // isPending, not isLoading: a disabled query reports isLoading
            // false, which would flash the "no longer exists" state in the
            // render between the dialog opening and the fetch starting.
            isLoading={detailQuery.isPending}
            jobs={jobs}
            jobsLoading={jobsQuery.isPending}
            now={detailQuery.dataUpdatedAt || undefined}
          />
        </Dialog.Body>
        {showFooter && group && (
          <GroupDetailFooter
            group={group}
            showRetry={showRetry}
            onRetry={onRetry}
            retryLoading={retryLoading}
            onDrain={onDrain}
          />
        )}
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
