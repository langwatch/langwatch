import { IdText } from "@langwatch/design-system/id-text";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, Button, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { RotateCcw, XCircle } from "lucide-react";

import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { JsonViewer } from "../../../../ui/elements/ops-json-viewer.tsx";
import {
  type DeadLetterAttemptHistoryRenderer,
  type DeadLetterMessage,
} from "../../model/dead-letter-types.ts";

export function DeadLetterRow({
  message,
  now,
  canManage,
  isExpanded,
  isRedriving,
  isDiscarding,
  onToggle,
  onRedrive,
  onDiscard,
  renderAttemptHistory,
}: {
  message: DeadLetterMessage;
  now: number;
  canManage: boolean;
  isExpanded: boolean;
  isRedriving: boolean;
  isDiscarding: boolean;
  onToggle: () => void;
  onRedrive: () => void;
  onDiscard: () => void;
  renderAttemptHistory?: DeadLetterAttemptHistoryRenderer;
}) {
  return (
    <>
      {/* The row opens on click; its first cell is a real button so the
          expanded region (the trace id, the only route to WHY the message
          died) is reachable by keyboard too. */}
      <ListTable.Row
        expanded={isExpanded}
        onActivate={onToggle}
        data-testid={`dead-row-${message.messageKey}`}
      >
        <ListTable.Cell>
          <chakra.button
            type="button"
            aria-expanded={isExpanded}
            textAlign="left"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            <Text textStyle="xs" fontWeight="medium">
              {message.processName}
            </Text>
          </chakra.button>
        </ListTable.Cell>
        <ListTable.Cell>
          <InlineCode variant="neutral">{message.intentType}</InlineCode>
        </ListTable.Cell>
        <ListTable.Cell>
          {/* Elided in the MIDDLE: both ends of a key carry information, and a
              right-truncated ksuid is indistinguishable from every other one
              sharing its prefix. */}
          <IdText value={message.processKey} label="ID" />
        </ListTable.Cell>
        <ListTable.Cell align="end">
          <Text textStyle="caption" fontVariantNumeric="tabular-nums">
            {message.attempts}
          </Text>
        </ListTable.Cell>
        <ListTable.Cell align="end">
          <Text textStyle="xs" color="fg.muted">
            {formatTimeAgo(message.updatedAt, now)}
          </Text>
        </ListTable.Cell>
        <ListTable.Cell align="end">
          {canManage && (
            <HStack gap={1} justify="end">
              <Button
                size="sm"
                variant="outline"
                loading={isRedriving}
                data-testid={`dead-redrive-${message.messageKey}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRedrive();
                }}
              >
                <RotateCcw size={12} />
                Redrive
              </Button>
              <Button
                size="sm"
                variant="outline"
                colorPalette="red"
                loading={isDiscarding}
                data-testid={`dead-discard-${message.messageKey}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onDiscard();
                }}
              >
                <XCircle size={12} />
                Discard
              </Button>
            </HStack>
          )}
        </ListTable.Cell>
      </ListTable.Row>
      {isExpanded && (
        <ListTable.SpanRow columns={6} band>
          <Box paddingX={4} paddingY={3}>
            <VStack align="stretch" gap={3}>
              <HStack gap={4} flexWrap="wrap">
                <Labelled label="Message key" value={message.messageKey} />
                <Labelled label="Project" value={message.projectId} />
                {message.traceId ? <Labelled label="Trace" value={message.traceId} /> : null}
              </HStack>
              {renderAttemptHistory?.(message)}
              <Box>
                <Text textStyle="2xs" color="fg.muted" marginBottom={1}>
                  Payload
                </Text>
                <JsonViewer data={message.payload} />
              </Box>
            </VStack>
          </Box>
        </ListTable.SpanRow>
      )}
    </>
  );
}

function Labelled({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text textStyle="2xs" color="fg.muted">
        {label}
      </Text>
      <InlineCode variant="neutral">{value}</InlineCode>
    </Box>
  );
}
