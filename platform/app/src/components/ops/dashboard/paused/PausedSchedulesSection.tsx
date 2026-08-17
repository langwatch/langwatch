import { Box, HStack, Table, Text } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";

/** A schedule the operator switched off, named by what it fires. */
export interface PausedSchedule {
  id: string;
  targetType: string;
  targetId: string;
  cron: string;
}

/**
 * Schedules that are switched off.
 *
 * A paused schedule is silent by design, which is exactly why it needs
 * reporting: nothing fires, nothing errors, and the only evidence is work that
 * never happened. `deriveStatus` already treats `active: false` as its own
 * state rather than as overdue — this section carries that state to the
 * dashboard so it is not something an operator has to go and look for.
 */
export function PausedSchedulesSection({
  schedules,
}: {
  schedules: PausedSchedule[];
}) {
  if (schedules.length === 0) return null;

  return (
    <Box>
      <HStack paddingX={4} paddingTop={3} paddingBottom={2} gap={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Switched-off schedules
        </Text>
        <Text textStyle="xs" color="fg.muted">
          these will not fire until an operator turns them back on
        </Text>
        <Link
          href="/ops/event-sourcing/schedules"
          fontSize="xs"
          color="fg.muted"
        >
          Schedules
        </Link>
      </HStack>
      <Table.ScrollArea>
        <Table.Root
          size="sm"
          variant="line"
          css={{ "& tr:last-child td": { borderBottom: "none" } }}
        >
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Fires</Table.ColumnHeader>
              <Table.ColumnHeader>Target</Table.ColumnHeader>
              <Table.ColumnHeader>Schedule</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {schedules.map((schedule) => (
              <Table.Row key={schedule.id} data-testid="paused-schedule-row">
                <Table.Cell>{schedule.targetType}</Table.Cell>
                <Table.Cell>
                  <Text fontFamily="mono" textStyle="xs">
                    {schedule.targetId}
                  </Text>
                </Table.Cell>
                <Table.Cell color="fg.muted">
                  <Text fontFamily="mono" textStyle="xs">
                    {schedule.cron}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    </Box>
  );
}
