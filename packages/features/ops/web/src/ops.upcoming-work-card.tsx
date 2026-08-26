import { Badge, Card, HStack, Table, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import type { OpsScheduledJob } from "@langwatch/ops-contract";
import { middleEllipsis } from "./queue.cluster-groups";

const VISIBLE_ROWS = 12;

interface TimedWorkRow {
  key: string;
  kind: "schedule" | "wake";
  what: string;
  where: string;
  dueAtMs: number;
}

export interface UpcomingProcessWake {
  processName: string;
  projectId: string;
  processKey: string;
  nextWakeAt: number;
}

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
    <Table.Row bg={overdue ? "orange.subtle" : undefined}>
      <Table.Cell>
        <Badge
          size="sm"
          variant="subtle"
          colorPalette={row.kind === "schedule" ? "blue" : "purple"}
        >
          {row.kind === "schedule" ? "schedule" : "process wake"}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono" title={row.what}>
          {middleEllipsis(row.what, 44)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted" title={row.where}>
          {middleEllipsis(row.where, 32)}
        </Text>
      </Table.Cell>
      <Table.Cell textAlign="end">
        <Text
          textStyle="xs"
          color={overdue ? "orange.500" : "fg.muted"}
          fontWeight={overdue ? "medium" : undefined}
          whiteSpace="nowrap"
        >
          {describeDue(row.dueAtMs, now)}
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * The next timed work across the platform — scheduled jobs and process-manager
 * wakes merged into one soonest-first table, overdue rows tinted and sorted to
 * the top. Answers "what fires next, and is anything late?" without leaving
 * the dashboard; the event-sourcing page keeps the full views.
 */
export function UpcomingWorkCard({
  schedules,
  wakes,
  now = Date.now(),
}: {
  schedules: OpsScheduledJob[];
  wakes: UpcomingProcessWake[];
  now?: number;
}) {
  const rows = useMemo(() => {
    const merged: TimedWorkRow[] = [];
    for (const job of schedules) {
      if (!job.active) continue;
      merged.push({
        key: `schedule:${job.id}`,
        kind: "schedule",
        what: `${job.targetType}/${job.targetId}`,
        where: job.projectName ?? job.projectId,
        dueAtMs: new Date(job.nextRunAt).getTime(),
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
  }, [schedules, wakes]);

  if (rows.length === 0) return null;

  const overdueCount = rows.filter((row) => row.dueAtMs < now).length;

  return (
    <Card.Root>
      <Card.Body padding={0}>
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
        <Table.ScrollArea>
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader width="130px">Kind</Table.ColumnHeader>
                <Table.ColumnHeader>What</Table.ColumnHeader>
                <Table.ColumnHeader>Where</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Due</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <TimedWorkRowView key={row.key} row={row} now={now} />
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Card.Body>
    </Card.Root>
  );
}
