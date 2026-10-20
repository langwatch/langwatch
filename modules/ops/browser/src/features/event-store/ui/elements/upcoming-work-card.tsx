import { Card } from "@langwatch/design-system/card";
import { IdText } from "@langwatch/design-system/id-text";
import { ListTable } from "@langwatch/design-system/list-table";
import { Badge, HStack, Text } from "@langwatch/design-system/primitives";
import type { OpsScheduledJob, ProcessWakeRow } from "@langwatch/ops-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";

import { middleEllipsis } from "../../../../model/queue-cluster-groups.ts";

const VISIBLE_ROWS = 12;

interface TimedWorkRow {
  key: string;
  kind: "schedule" | "wake";
  what: string;
  where: string;
  dueAtMs: number;
}

export type UpcomingProcessWake = ProcessWakeRow;

function describeDue(dueAtMs: number, now: number): string {
  const deltaMs = dueAtMs - now;
  const absoluteDeltaMs = Math.abs(deltaMs);
  const unit = describeDuration(absoluteDeltaMs);

  return deltaMs < 0 ? `${unit} overdue` : `in ${unit}`;
}

function describeDuration(durationMs: number): string {
  if (durationMs >= 3_600_000) {
    return `${Math.round(durationMs / 3_600_000)}h`;
  }

  if (durationMs >= 60_000) {
    return `${Math.round(durationMs / 60_000)}m`;
  }

  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
}

function TimedWorkRowView({ row, now }: { row: TimedWorkRow; now: number }) {
  const overdue = row.dueAtMs < now;
  return (
    <ListTable.Row tone={overdue ? "warning" : undefined}>
      <ListTable.Cell>
        <Badge
          size="sm"
          variant="subtle"
          colorPalette={row.kind === "schedule" ? "blue" : "purple"}
        >
          {row.kind === "schedule" ? "schedule" : "process wake"}
        </Badge>
      </ListTable.Cell>
      <ListTable.Cell>
        <IdText value={row.what} label="ID" />
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="xs" color="fg.muted" title={row.where}>
          {middleEllipsis(row.where, 32)}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell align="end">
        <Text
          textStyle="xs"
          color={overdue ? "fg.warning" : "fg.muted"}
          fontWeight={overdue ? "medium" : undefined}
          whiteSpace="nowrap"
        >
          {describeDue(row.dueAtMs, now)}
        </Text>
      </ListTable.Cell>
    </ListTable.Row>
  );
}

/**
 * The next timed work across the platform - scheduled jobs and
 * process-manager wakes merged into one soonest-first table, overdue rows
 * tinted and sorted to the top, so nothing needs leaving the dashboard.
 */
export function UpcomingWorkCard({
  schedules,
  wakes,
  now = nowInstant().epochMilliseconds,
}: {
  schedules: OpsScheduledJob[];
  wakes: UpcomingProcessWake[];
  now?: number;
}) {
  const rows = (() => {
    const merged: TimedWorkRow[] = [];
    for (const job of schedules) {
      if (!job.active || job.nextRunAt === null) continue;
      merged.push({
        key: `schedule:${job.id}`,
        kind: "schedule",
        what: `${job.targetType}/${job.targetId}`,
        where: job.projectName ?? job.projectId,
        dueAtMs: toEpochMs(job.nextRunAt),
      });
    }
    for (const wake of wakes) {
      merged.push({
        key: `wake:${wake.processName}:${wake.projectId}:${wake.processKey}`,
        kind: "wake",
        what: wake.processName,
        where: wake.processKey,
        dueAtMs: wake.nextWakeAt,
      });
    }
    merged.sort((left, right) => left.dueAtMs - right.dueAtMs);
    return merged.slice(0, VISIBLE_ROWS);
  })();

  if (rows.length === 0) return null;

  const overdueCount = rows.filter((row) => row.dueAtMs < now).length;

  return (
    <Card padding="none">
      <HStack
        paddingX={4}
        paddingY={2.5}
        borderBottom="1px solid"
        borderBottomColor="border"
        gap={2}
      >
        <Text textStyle="sm" fontWeight="medium">
          Upcoming timed work
        </Text>
        <Text textStyle="xs" color="fg.muted">
          schedules and process wakes, soonest first
        </Text>
        {overdueCount > 0 && (
          <Badge size="sm" variant="subtle" colorPalette="orange">
            {overdueCount} overdue
          </Badge>
        )}
      </HStack>
      <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Upcoming timed work">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader width={130}>Kind</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>What</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Where</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Due</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {rows.map((row) => (
            <TimedWorkRowView key={row.key} row={row} now={now} />
          ))}
        </ListTable.Body>
      </ListTable>
    </Card>
  );
}
