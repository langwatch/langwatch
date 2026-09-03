import { Box, Button, HStack, Table, Text, VStack } from "@chakra-ui/react";
import { RotateCcw, XCircle } from "lucide-react";
import { formatTimeAgo } from "../../../../model/ops-formatters";
import { JsonViewer } from "../../../../ui/elements/ops-json-viewer";
import { middleEllipsis } from "../../../../model/queue-cluster-groups";
import {
  type DeadLetterAttemptHistoryRenderer,
  type DeadLetterMessage,
} from "../../model/dead-letter-types";

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
      {/* Reachable by keyboard, not only by mouse. The expanded region holds
          the trace id, which is the only route from this page to WHY the
          message died — so a row that opens on click alone puts the
          diagnosis behind a pointer. */}
      <Table.Row
        cursor="pointer"
        onClick={onToggle}
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
        onKeyDown={(event) => {
          // Only the row's own key events. Enter or Space on the nested
          // Redrive button bubbles up here too, and without this the
          // operator would redrive AND toggle the row in one press.
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle();
        }}
        data-testid={`dead-row-${message.messageKey}`}
      >
        <Table.Cell>
          <Text textStyle="xs" fontWeight="medium">
            {message.processName}
          </Text>
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
                {message.traceId ? (
                  <Labelled label="Trace" value={message.traceId} />
                ) : null}
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
