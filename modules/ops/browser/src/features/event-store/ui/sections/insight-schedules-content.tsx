import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Center, Heading, Spinner, Table, Text, VStack } from "@langwatch/design-system/primitives";
import type { OpsInsightSchedule } from "@langwatch/ops-contract";
import { nowInstant, readableDate, toEpochMs } from "@langwatch/time";
import { Inbox } from "lucide-react";

import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { middleEllipsis } from "../../../../model/queue-cluster-groups.ts";
import {
  compareInsightSchedules,
  insightScheduleStatus,
  lastRunWords,
  offReasonWords,
  runTimeWords,
  skippedDaysWords,
} from "../../model/insight-schedule-presentation.ts";
import { InsightScheduleStatusBadge } from "../blocks/insight-schedule-status-badge.tsx";

/**
 * Every person's daily insights schedule, page-independent and read only: a schedule is its
 * person's own setting, so an operator reads it here and changes nothing.
 */
export function InsightSchedulesContentView({
  schedules,
  isLoading,
  now = nowInstant().epochMilliseconds,
}: {
  schedules: OpsInsightSchedule[];
  isLoading: boolean;
  now?: number;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <Heading size="sm">Daily insights</Heading>
      <InsightSchedulesTable schedules={schedules} isLoading={isLoading} now={now} />
    </VStack>
  );
}

function InsightSchedulesTable({
  schedules,
  isLoading,
  now,
}: {
  schedules: OpsInsightSchedule[];
  isLoading: boolean;
  now: number;
}) {
  if (isLoading) {
    return (
      <Center paddingY={10}>
        <Spinner size="lg" aria-label="Loading daily insights schedules" />
      </Center>
    );
  }

  if (schedules.length === 0) {
    return (
      <NoDataInfoBlock
        icon={<Inbox />}
        title="No daily insights schedules"
        description="Nobody has turned daily insights on for a board yet."
      />
    );
  }

  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      variant="line"
      size="sm"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Board</Table.ColumnHeader>
          <Table.ColumnHeader>Owner</Table.ColumnHeader>
          <Table.ColumnHeader>Schedule</Table.ColumnHeader>
          <Table.ColumnHeader>Next run</Table.ColumnHeader>
          <Table.ColumnHeader>Last run</Table.ColumnHeader>
          <Table.ColumnHeader>Skipped days</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {schedules.toSorted(compareInsightSchedules).map((schedule) => (
          <InsightScheduleRow key={schedule.id} schedule={schedule} now={now} />
        ))}
      </Table.Body>
    </ListTable>
  );
}

function InsightScheduleRow({ schedule, now }: { schedule: OpsInsightSchedule; now: number }) {
  const status = insightScheduleStatus(schedule);
  const { nextRunAt, lastRunAt } = schedule;

  return (
    <Table.Row>
      <Table.Cell>
        <Text textStyle="xs" title={`${schedule.boardKind} · ${schedule.boardId}`}>
          {schedule.boardName}
        </Text>
        <Text textStyle="xs" color="fg.muted" title={schedule.projectId}>
          {schedule.projectName ?? middleEllipsis(schedule.projectId, 18)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" title={schedule.userId}>
          {schedule.owner ?? middleEllipsis(schedule.userId, 18)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs">{runTimeWords(schedule)}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text
          textStyle="xs"
          title={nextRunAt ? readableDate(nextRunAt).toLocaleString() : undefined}
        >
          {nextRunText({ schedule, now })}
        </Text>
      </Table.Cell>
      <Table.Cell color="fg.muted">
        <Text
          textStyle="xs"
          title={lastRunAt ? readableDate(lastRunAt).toLocaleString() : undefined}
        >
          {lastRunAt ? `${formatTimeAgo(toEpochMs(lastRunAt), now)} · ` : ""}
          {lastRunWords(schedule)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs">{skippedDaysWords(schedule)}</Text>
      </Table.Cell>
      <Table.Cell>
        <InsightScheduleStatusBadge status={status} />
        {status === "turned_off" && (
          <Text textStyle="xs" color="fg.muted">
            {offReasonWords(schedule)}
          </Text>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

/** A schedule that is on with no wake armed says so: it is the row an operator came for. */
function nextRunText({ schedule, now }: { schedule: OpsInsightSchedule; now: number }): string {
  if (schedule.nextRunAt !== null) return formatTimeAgo(toEpochMs(schedule.nextRunAt), now);
  return schedule.on ? "not armed" : "none";
}
