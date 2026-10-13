import { Link } from "@langwatch/browser-host/link";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { PausedSchedule } from "../../model/paused-schedule.ts";

export const PAUSED_SCHEDULES_HREF = "/ops/event-sourcing/schedules";

/** Paused schedules (silent by design, need reporting—work never happened without
 * errors). Dashboard so operators don't hunt for them. */
export function PausedSchedulesSection({
  schedules,
  total,
  renderSchedulesLink,
}: {
  schedules: PausedSchedule[];
  /** Every switched-off schedule in the fleet; `schedules` is one page of it. */
  total: number;
  renderSchedulesLink?: (href: string) => ReactNode;
}) {
  if (schedules.length === 0) return null;

  return (
    <Box>
      <HStack paddingX={4} paddingTop={3} paddingBottom={2} gap={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Switched-off schedules
        </Text>
        {total > schedules.length && (
          <Text textStyle="xs" color="fg.muted">
            showing {schedules.length} of {total}
          </Text>
        )}
        <Text textStyle="xs" color="fg.muted">
          these will not fire until an operator turns them back on
        </Text>
        {renderSchedulesLink ? (
          renderSchedulesLink(PAUSED_SCHEDULES_HREF)
        ) : (
          <Link unstyled href={PAUSED_SCHEDULES_HREF}>
            Schedules
          </Link>
        )}
      </HStack>
      <ListTable
        density="compact"
        variant="embedded"
        scroll="x"
        scrollLabel="Switched-off schedules"
      >
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Fires</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Target</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Schedule</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {schedules.map((schedule) => (
            <ListTable.Row key={schedule.id} data-testid="paused-schedule-row">
              <ListTable.Cell>{schedule.targetType}</ListTable.Cell>
              <ListTable.Cell>
                <InlineCode variant="neutral">{schedule.targetId}</InlineCode>
              </ListTable.Cell>
              <ListTable.Cell tone="muted">
                <InlineCode variant="neutral">{schedule.cron}</InlineCode>
              </ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </Box>
  );
}
