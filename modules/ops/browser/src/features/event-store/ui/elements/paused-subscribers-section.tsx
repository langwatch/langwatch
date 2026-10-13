import { Link } from "@langwatch/browser-host/link";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
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
          <Link unstyled href={PAUSED_SUBSCRIBERS_HREF}>
            Subscribers
          </Link>
        )}
      </HStack>
      <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Paused subscribers">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Paused</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {pausedKeys.map((key) => (
            <ListTable.Row key={key} data-testid="paused-subscriber-row">
              <ListTable.Cell>
                <InlineCode variant="neutral">{key}</InlineCode>
              </ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </Box>
  );
}
