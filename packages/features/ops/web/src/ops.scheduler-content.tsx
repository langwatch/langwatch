import {
  Badge,
  Center,
  EmptyState,
  HStack,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { CalendarClock } from "lucide-react";
import type { OpsScheduledJob, SchedulerAuditEntryView } from "@langwatch/ops-contract";
import type { ReactNode } from "react";
import type { SchedulerJobStatus } from "./ops.scheduler-presentation";
import { formatTimeAgo } from "./formatters";
import { middleEllipsis } from "./queue.cluster-groups";
import { SchedulerHeader } from "./ops.scheduler-header";
import { SchedulerRecentActions } from "./ops.scheduler-recent-actions";
import { SchedulerStatusBadge } from "./ops.scheduler-status-badge";
import {
  compareForAttention,
  deriveLoopHealth,
  deriveStatus,
  latenessMs,
  summarize,
} from "./ops.scheduler-presentation";

/**
 * The scheduler surface, page-independent: scheduled work across every
 * project — when each next runs, when it last ran, and whether anything is
 * behind. Lives on the event-sourcing page as its time-driven section.
 */
export function SchedulerContentView({
  jobs,
  recentActions,
  isLoading,
  hasAccess,
  now = Date.now(),
  renderActions,
}: {
  jobs: OpsScheduledJob[];
  recentActions: SchedulerAuditEntryView[];
  isLoading: boolean;
  hasAccess: boolean;
  now?: number;
  renderActions?: (
    job: OpsScheduledJob,
    status: SchedulerJobStatus,
    now: number,
  ) => ReactNode;
}) {
  const sorted = [...jobs].sort((a, b) => compareForAttention({ a, b, now }));
  const counts = summarize({ jobs, now });
  const loop = deriveLoopHealth({ jobs, now });

  if (isLoading) {
    return (
      <Center paddingY={20}>
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <Spinner size="lg" />
            </EmptyState.Indicator>
            <EmptyState.Title>Loading scheduled jobs</EmptyState.Title>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    );
  }

  if (jobs.length === 0) {
    return (
      <Center paddingY={20}>
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <CalendarClock />
            </EmptyState.Indicator>
            <EmptyState.Title>No scheduled jobs</EmptyState.Title>
            <EmptyState.Description>
              Nothing is on the calendar scheduler yet.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    );
  }

  return (
    <>
      <SchedulerHeader
        counts={counts}
        loopHealthy={loop.healthy}
        lastFiredAt={loop.lastFiredAt}
      />
      <Table.Root variant="line" size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Target</Table.ColumnHeader>
            <Table.ColumnHeader>Schedule</Table.ColumnHeader>
            <Table.ColumnHeader>Next run</Table.ColumnHeader>
            <Table.ColumnHeader>Last run</Table.ColumnHeader>
            <Table.ColumnHeader>Status</Table.ColumnHeader>
            <Table.ColumnHeader width="40px" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sorted.map((job) => (
            <ScheduleRow
              key={job.id}
              job={job}
              now={now}
              hasAccess={hasAccess}
              renderActions={renderActions}
            />
          ))}
        </Table.Body>
      </Table.Root>
      <SchedulerRecentActions entries={recentActions} />
    </>
  );
}

/** One schedule, with the row-level controls an `ops:manage` operator gets. */
function ScheduleRow({
  job,
  now,
  hasAccess,
  renderActions,
}: {
  job: OpsScheduledJob;
  now: number;
  hasAccess: boolean;
  renderActions?: (
    job: OpsScheduledJob,
    status: SchedulerJobStatus,
    now: number,
  ) => ReactNode;
}) {
  const status = deriveStatus({ job, now });

  return (
    <Table.Row>
      <Table.Cell>
        <HStack gap={2}>
          <Badge colorPalette="purple" variant="subtle">
            {job.targetType}
          </Badge>
          <Text textStyle="xs" title={`${job.targetId} · ${job.projectId}`}>
            {middleEllipsis(job.targetId, 28)}
          </Text>
          <Text textStyle="xs" color="fg.muted">
            {job.projectName ?? middleEllipsis(job.projectId, 18)}
          </Text>
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono">
          {job.cron}
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {job.timezone}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" title={new Date(job.nextRunAt).toLocaleString()}>
          {formatTimeAgo(new Date(job.nextRunAt).getTime(), now)}
        </Text>
      </Table.Cell>
      <Table.Cell color="fg.muted">
        <Text
          textStyle="xs"
          title={job.lastSlot ? new Date(job.lastSlot).toLocaleString() : undefined}
        >
          {job.lastSlot ? formatTimeAgo(new Date(job.lastSlot).getTime(), now) : "never"}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <SchedulerStatusBadge
          status={status}
          latenessMs={latenessMs({ job, now })}
          attempts={job.attempts}
          lastError={job.lastError}
        />
      </Table.Cell>
      <Table.Cell>
        {/* A view-only operator is shown no control they cannot use, rather
            than one that errors. */}
        {hasAccess && renderActions?.(job, status, now)}
      </Table.Cell>
    </Table.Row>
  );
}
