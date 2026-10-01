import {
  Box,
  Button,
  chakra,
  HStack,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { RotateCcw, XCircle } from "lucide-react";

import { formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { middleEllipsis } from "../../../../model/queue-cluster-groups.ts";
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
      <Table.Row cursor="pointer" onClick={onToggle} data-testid={`dead-row-${message.messageKey}`}>
        <Table.Cell>
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
        </Table.Cell>
        <Table.Cell>
          <Text textStyle="xs" fontFamily="mono">
            {message.intentType}
          </Text>
        </Table.Cell>
        <Table.Cell>
          {/* Elided in the MIDDLE: both ends of a key carry information, and a
              right-truncated ksuid is indistinguishable from every other one
              sharing its prefix. */}
          <Text textStyle="xs" fontFamily="mono" color="fg.muted">
            {middleEllipsis(message.processKey, 32)}
          </Text>
        </Table.Cell>
        <Table.Cell textAlign="end">
          <Text textStyle="xs" fontFamily="mono">
            {message.attempts}
          </Text>
        </Table.Cell>
        <Table.Cell textAlign="end">
          <Text textStyle="xs" color="fg.muted">
            {formatTimeAgo(message.updatedAt, now)}
          </Text>
        </Table.Cell>
        <Table.Cell textAlign="end">
          {canManage && (
            <HStack gap={1} justify="end">
              <Button
                size="xs"
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
                size="xs"
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
        </Table.Cell>
      </Table.Row>
      {isExpanded && (
        <Table.Row>
          <Table.Cell colSpan={6} bg="bg.subtle">
            <VStack align="stretch" gap={3} paddingY={2}>
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
          </Table.Cell>
        </Table.Row>
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
      <Text textStyle="xs" fontFamily="mono">
        {value}
      </Text>
    </Box>
  );
}
