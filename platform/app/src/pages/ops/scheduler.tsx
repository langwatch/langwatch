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
import { useMemo } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { middleEllipsis } from "~/components/ops/queues/clusterGroups";
import { SchedulerHeader } from "~/components/ops/scheduler/SchedulerHeader";
import { SchedulerRecentActions } from "~/components/ops/scheduler/SchedulerRecentActions";
import { SchedulerRowActions } from "~/components/ops/scheduler/SchedulerRowActions";
import { SchedulerStatusBadge } from "~/components/ops/scheduler/SchedulerStatusBadge";
import {
  compareForAttention,
  deriveLoopHealth,
  deriveStatus,
  isSlotStale,
  latenessMs,
  summarize,
} from "~/components/ops/scheduler/schedulerStatus";
import { formatTimeAgo } from "~/components/ops/shared/formatters";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api, type RouterOutputs } from "~/utils/api";

export default function OpsSchedulerPage() {
  const jobs = api.ops.listScheduledJobs.useQuery(
    { limit: 200 },
    { refetchInterval: 10_000 },
  );

  const { hasAccess } = useOpsPermission();
  const rows = useMemo(() => jobs.data ?? [], [jobs.data]);
  // One `now` for the whole render so a row cannot be judged against a
  // different instant than the header that summarises it — and it advances with
  // the data rather than with the clock, so an unrelated re-render cannot
  // invalidate every memo below. The 10s refetch is what keeps it current.
  const now = jobs.dataUpdatedAt || Date.now();

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareForAttention({ a, b, now })),
    [rows, now],
  );
  const counts = useMemo(() => summarize({ jobs: rows, now }), [rows, now]);
  const loop = useMemo(
    () => deriveLoopHealth({ jobs: rows, now }),
    [rows, now],
  );

  return (
    <OpsPageShell>
      <DashboardLayout>
        <PageLayout.Header>
          <PageLayout.Heading>Scheduler</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Container>
          <Text textStyle="sm" color="fg.muted" marginBottom={4}>
            Scheduled work across every project: when each next runs, when it
            last ran, and whether anything is behind.
          </Text>

          {jobs.isLoading ? (
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
          ) : rows.length === 0 ? (
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
          ) : (
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
                      onDone={() => void jobs.refetch()}
                    />
                  ))}
                </Table.Body>
              </Table.Root>
              <SchedulerRecentActions />
            </>
          )}
        </PageLayout.Container>
      </DashboardLayout>
    </OpsPageShell>
  );
}

/** One schedule, with the row-level controls an `ops:manage` operator gets. */
function ScheduleRow({
  job,
  now,
  hasAccess,
  onDone,
}: {
  job: RouterOutputs["ops"]["listScheduledJobs"][number];
  now: number;
  hasAccess: boolean;
  onDone: () => void;
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
          {formatTimeAgo(new Date(job.nextRunAt).getTime())}
        </Text>
      </Table.Cell>
      <Table.Cell color="fg.muted">
        <Text
          textStyle="xs"
          title={
            job.lastSlot ? new Date(job.lastSlot).toLocaleString() : undefined
          }
        >
          {job.lastSlot
            ? formatTimeAgo(new Date(job.lastSlot).getTime())
            : "never"}
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
        {hasAccess && (
          <SchedulerRowActions
            scheduleId={job.id}
            targetType={job.targetType}
            targetId={job.targetId}
            projectName={job.projectName}
            status={status}
            canClearSlot={isSlotStale({ job, now })}
            onDone={onDone}
          />
        )}
      </Table.Cell>
    </Table.Row>
  );
}
