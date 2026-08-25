// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { Box, Code, SimpleGrid, Table, Text } from "@chakra-ui/react";

import type { SourceEventRowData } from "./source-events-table";

/**
 * The expanded detail of one event row: the normalised OCSF record next
 * to the raw payload as ingested. Rendered as a full-width row directly
 * under the event it belongs to.
 */
export function EventDetailRow({
  event,
  colSpan,
}: {
  event: SourceEventRowData;
  colSpan: number;
}) {
  return (
    <Table.Row>
      <Table.Cell colSpan={colSpan} bg="bg.subtle">
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={3} paddingY={1}>
          <NormalisedPanel event={event} />
          <RawPanel event={event} />
        </SimpleGrid>
      </Table.Cell>
    </Table.Row>
  );
}

function NormalisedPanel({ event }: { event: SourceEventRowData }) {
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted" marginBottom={1}>
        Normalised (OCSF)
      </Text>
      <Code
        display="block"
        padding={3}
        fontSize="xs"
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        backgroundColor="bg.panel"
      >
        {JSON.stringify(
          {
            eventId: event.eventId,
            eventType: event.eventType,
            actor: event.actor,
            action: event.action,
            target: event.target,
            costUsd: event.costUsd,
            tokensInput: event.tokensInput,
            tokensOutput: event.tokensOutput,
            eventTimestamp: event.eventTimestampIso,
            ingestedAt: event.ingestedAtIso,
          },
          null,
          2,
        )}
      </Code>
    </Box>
  );
}

function RawPanel({ event }: { event: SourceEventRowData }) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(event.rawPayload);
  } catch {
    // fall through with parsed = null
  }
  return (
    <Box>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted" marginBottom={1}>
        Raw payload (as ingested)
      </Text>
      {event.rawPayload ? (
        <Code
          display="block"
          padding={3}
          fontSize="xs"
          whiteSpace="pre-wrap"
          wordBreak="break-all"
          backgroundColor="bg.panel"
        >
          {parsed != null ? JSON.stringify(parsed, null, 2) : event.rawPayload}
        </Code>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          The raw body is not stored for this source type — pushed events are normalised
          at the edge and only the normalised record is kept.
        </Text>
      )}
    </Box>
  );
}
