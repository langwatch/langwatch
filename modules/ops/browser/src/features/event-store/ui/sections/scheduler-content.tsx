import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, HStack, Text } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { OpsScheduledJob, SchedulerAuditEntryView } from "@langwatch/ops-contract";
import { nowInstant, toEpochMs, readableDate } from "@langwatch/time";
import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";

import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { middleEllipsis } from "../../../../model/queue-cluster-groups.ts";
import type { SchedulerJobStatus } from "../../model/scheduler-presentation.ts";
import {
  compareForAttention,
  deriveLoopHealth,
  deriveStatus,
  latenessMs,
  summarize,
} from "../../model/scheduler-presentation.ts";
import { SchedulerHeader } from "../blocks/scheduler-header.tsx";
import { SchedulerStatusBadge } from "../blocks/scheduler-status-badge.tsx";
import { SchedulerRecentActions } from "../elements/scheduler-recent-actions.tsx";

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
  now = nowInstant().epochMilliseconds,
  renderActions,
}: {
  jobs: OpsScheduledJob[];
  recentActions: SchedulerAuditEntryView[];
  isLoading: boolean;
  hasAccess: boolean;
  now?: number;
  renderActions?: (job: OpsScheduledJob, status: SchedulerJobStatus, now: number) => ReactNode;
}) {
  const sorted = [...jobs].toSorted((a, b) => compareForAttention({ a, b, now }));
  const counts = summarize({ jobs, now });
  const loop = deriveLoopHealth({ jobs, now });

  if (isLoading) {
    return <SkeletonRows rows={6} />;
  }

  if (jobs.length === 0) {
    return (
      <NoDataInfoBlock
        icon={<CalendarClock />}
        title="No scheduled jobs"
        description="Nothing is on the calendar scheduler yet."
      />
    );
  }

  return (
    <>
      <SchedulerHeader counts={counts} loopHealthy={loop.healthy} lastFiredAt={loop.lastFiredAt} />
      <ListTable density="compact" scroll="x" scrollLabel="Scheduled jobs table">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Target</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Schedule</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Next run</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Last run</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
            <ListTable.ActionHeader />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {sorted.map((job) => (
            <ScheduleRow
              key={job.id}
              job={job}
              now={now}
              hasAccess={hasAccess}
              renderActions={renderActions}
            />
          ))}
        </ListTable.Body>
      </ListTable>
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
  renderActions?: (job: OpsScheduledJob, status: SchedulerJobStatus, now: number) => ReactNode;
}) {
  const status = deriveStatus({ job, now });

  return (
    <ListTable.Row>
      <ListTable.Cell>
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
      </ListTable.Cell>
      <ListTable.Cell>
        <InlineCode variant="neutral">{job.cron}</InlineCode>
        <Text textStyle="xs" color="fg.muted">
          {job.timezone}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text
          textStyle="xs"
          title={job.nextRunAt ? readableDate(job.nextRunAt).toLocaleString() : undefined}
        >
          {job.nextRunAt ? formatTimeAgo(toEpochMs(job.nextRunAt), now) : "not scheduled"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell tone="muted">
        <Text
          textStyle="xs"
          title={job.lastSlot ? readableDate(job.lastSlot).toLocaleString() : undefined}
        >
          {job.lastSlot ? formatTimeAgo(toEpochMs(job.lastSlot), now) : "never"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <SchedulerStatusBadge
          status={status}
          latenessMs={latenessMs({ job, now })}
          attempts={job.attempts}
          lastError={job.lastError}
        />
      </ListTable.Cell>
      <ListTable.ActionCell>
        {/* A view-only operator is shown no control they cannot use, rather
            than one that errors. */}
        {hasAccess && renderActions?.(job, status, now)}
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}
