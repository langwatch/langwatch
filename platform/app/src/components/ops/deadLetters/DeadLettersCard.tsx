import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { RotateCcw, Skull, XCircle } from "lucide-react";
import { JsonViewer } from "@langwatch/ops-web";
import { middleEllipsis } from "@langwatch/ops-web";
import { formatTimeAgo } from "@langwatch/ops-web";
import { api } from "~/utils/api";

/** Exactly what this surface renders; a structural subset of the server view. */
export interface DeadLetterMessage {
  id: string;
  processName: string;
  projectId: string;
  processKey: string;
  messageKey: string;
  intentType: string;
  attempts: number;
  updatedAt: number;
  traceId: string | null;
  payload: unknown;
}

export interface DeadLetterProcessCount {
  processName: string;
  count: number;
  oldestUpdatedAt: number;
}

/**
 * The all-clear.
 *
 * Kept as a full statement rather than an empty page: on an ops surface a
 * visible zero is how the operator knows the panel is live and the fleet is
 * clean, which is not the same thing as a page that rendered nothing.
 */
export function DeadLettersEmpty() {
  return (
    <Card.Root>
      <Card.Body padding={6}>
        <HStack gap={3}>
          <Skull size={16} />
          <Box>
            <Text textStyle="sm" fontWeight="medium">
              No dead messages
            </Text>
            <Text textStyle="xs" color="fg.muted">
              Every intent the substrate has emitted either dispatched or is still being
              retried.
            </Text>
          </Box>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Which processes are dead and how stale, doubling as the filter.
 *
 * One button per process rather than a dropdown: the breakdown IS the
 * diagnosis most of the time, and an operator mid-incident should not have to
 * open a control to read it.
 */
export function DeadLetterSummary({
  byProcess,
  selected,
  now,
  onSelect,
}: {
  byProcess: DeadLetterProcessCount[];
  selected: string | undefined;
  now: number;
  onSelect: (processName: string | undefined) => void;
}) {
  const fleetTotal = byProcess.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card.Root>
      <Card.Body padding={4}>
        <HStack gap={2} marginBottom={3}>
          <Box color="red.500">
            <Skull size={16} />
          </Box>
          <Text textStyle="sm" fontWeight="medium" data-testid="dead-total">
            {fleetTotal} dead {fleetTotal === 1 ? "message" : "messages"} across{" "}
            {byProcess.length} {byProcess.length === 1 ? "process" : "processes"}
          </Text>
        </HStack>
        <HStack gap={2} flexWrap="wrap">
          <Button
            size="xs"
            variant={selected === undefined ? "solid" : "outline"}
            onClick={() => onSelect(undefined)}
          >
            All
          </Button>
          {byProcess.map((row) => (
            <Button
              key={row.processName}
              size="xs"
              data-testid={`dead-filter-${row.processName}`}
              variant={selected === row.processName ? "solid" : "outline"}
              onClick={() => onSelect(row.processName)}
            >
              {row.processName}
              <Badge size="xs" colorPalette="red" marginLeft={1}>
                {row.count}
              </Badge>
              {/* `as="span"`: Chakra's Text renders a <p>, which a <button>
                  may not contain — the browser closes the button early and
                  the chip stops being one control. */}
              <Text as="span" textStyle="xs" color="fg.muted" marginLeft={1}>
                oldest {formatTimeAgo(row.oldestUpdatedAt, now)}
              </Text>
            </Button>
          ))}
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

/** The dead messages themselves, newest retirement first. */
export function DeadLettersTable({
  messages,
  now,
  canManage,
  expandedId,
  redrivingId,
  discardingId,
  onToggle,
  onRedrive,
  onDiscard,
}: {
  messages: DeadLetterMessage[];
  now: number;
  canManage: boolean;
  expandedId: string | null;
  redrivingId: string | null;
  discardingId: string | null;
  onToggle: (id: string) => void;
  onRedrive: (message: DeadLetterMessage) => void;
  onDiscard: (message: DeadLetterMessage) => void;
}) {
  return (
    <Card.Root>
      <Card.Body padding={0}>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Process</Table.ColumnHeader>
              <Table.ColumnHeader>Intent</Table.ColumnHeader>
              <Table.ColumnHeader>Process key</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Attempts</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Retired</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {messages.map((message) => (
              <DeadLetterRow
                key={message.id}
                message={message}
                now={now}
                canManage={canManage}
                isExpanded={expandedId === message.id}
                isRedriving={redrivingId === message.id}
                isDiscarding={discardingId === message.id}
                onToggle={() => onToggle(message.id)}
                onRedrive={() => onRedrive(message)}
                onDiscard={() => onDiscard(message)}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}

function DeadLetterRow({
  message,
  now,
  canManage,
  isExpanded,
  isRedriving,
  isDiscarding,
  onToggle,
  onRedrive,
  onDiscard,
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
              <AttemptHistory outboxId={message.id} projectId={message.projectId} />
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

/**
 * Why the message died, on the page: its failed attempts, oldest first
 * (specs/ops/dead-letter-recovery.feature). Fetched on expand — the history
 * only exists for messages that failed, and only an opened row needs it.
 * Messages retired before the attempt log existed have no entries; the trace
 * id above remains the join for those.
 *
 * Ordered chronologically rather than by attempt number, because a redrive
 * resets the count: a message that failed, was redriven, and failed again
 * carries two entries numbered 1, and only time puts them in the order they
 * happened.
 */
function AttemptHistory({
  outboxId,
  projectId,
}: {
  outboxId: string;
  projectId: string;
}) {
  const attempts = api.ops.listOutboxAttempts.useQuery({ outboxId, projectId });
  if (attempts.isPending) return <Spinner size="xs" />;
  const rows = attempts.data ?? [];
  if (rows.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        No recorded attempts — this message was retired before failures were recorded per
        attempt.
      </Text>
    );
  }
  return (
    <Box>
      <Text textStyle="2xs" color="fg.muted" marginBottom={1}>
        Attempts
      </Text>
      <VStack align="stretch" gap={1}>
        {rows.map((row) => (
          // Keyed by row id, not attempt number: a redrive resets the count,
          // so one message can hold two entries numbered 1.
          <HStack
            key={row.id}
            gap={2}
            align="start"
            data-testid={`dead-attempt-${row.attempt}`}
          >
            <Badge
              size="xs"
              colorPalette={row.outcome === "dead" ? "red" : "orange"}
              variant="subtle"
              flexShrink={0}
            >
              {row.attempt}
            </Badge>
            <Text textStyle="xs" fontFamily="mono" color="red.500">
              {row.errorType}
            </Text>
            <Text textStyle="xs" color="fg.muted">
              {row.errorMessage}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Box>
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
