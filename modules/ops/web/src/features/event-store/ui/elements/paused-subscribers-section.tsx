import { Box, HStack, Table, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

export const PAUSED_SUBSCRIBERS_HREF = "/ops/event-sourcing/subscribers";

/** Paused subscribers/pipelines (easy to forget after incidents). Events queue behind
 * pause; backlog without error is forgetting symptom. Keys shown as written. */
export function PausedSubscribersSection({
  pausedKeys,
  renderSubscribersLink,
}: {
  pausedKeys: string[];
  renderSubscribersLink?: (href: string) => ReactNode;
}) {
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
        {renderSubscribersLink ? (
          renderSubscribersLink(PAUSED_SUBSCRIBERS_HREF)
        ) : (
          <a href={PAUSED_SUBSCRIBERS_HREF}>Subscribers</a>
        )}
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
