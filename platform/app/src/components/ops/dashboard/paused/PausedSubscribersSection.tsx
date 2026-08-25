import { Box, HStack, Table, Text } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";

/**
 * Subscribers and pipelines an operator paused.
 *
 * Pausing is how an operator stops a bad subscriber from burning through
 * events during an incident, which makes it the single easiest thing to leave
 * switched on afterwards. Events still arrive and simply queue behind the
 * pause, so the symptom of forgetting is a backlog with no error attached to
 * it — reported here rather than only on the subscribers page.
 *
 * A key is either a pipeline name or `<pipeline>/subscriber`; both are the
 * operator's own vocabulary from the pause control, so they are shown as
 * written rather than resolved against the registry.
 */
export function PausedSubscribersSection({ pausedKeys }: { pausedKeys: string[] }) {
  if (pausedKeys.length === 0) return null;

  return (
    <Box>
      <HStack paddingX={4} paddingTop={3} paddingBottom={2} gap={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          Paused subscribers
        </Text>
        <Text textStyle="xs" color="fg.muted">
          events are queueing behind these until they are resumed
        </Text>
        <Link href="/ops/event-sourcing/subscribers" fontSize="xs" color="fg.muted">
          Subscribers
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
              <Table.ColumnHeader>Paused</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {pausedKeys.map((key) => (
              <Table.Row key={key} data-testid="paused-subscriber-row">
                <Table.Cell>
                  <Text fontFamily="mono" textStyle="xs">
                    {key}
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
