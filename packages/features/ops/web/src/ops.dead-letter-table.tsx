import { Card, Table } from "@chakra-ui/react";
import { DeadLetterRow } from "./ops.dead-letter-row";
import type {
  DeadLetterAttemptHistoryRenderer,
  DeadLetterMessage,
} from "./ops.dead-letter-types";

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
  renderAttemptHistory,
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
  renderAttemptHistory?: DeadLetterAttemptHistoryRenderer;
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
                renderAttemptHistory={renderAttemptHistory}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}
