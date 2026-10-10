import { ListTable } from "@langwatch/design-system/list-table";
import { Card, Table } from "@langwatch/design-system/primitives";

import type {
  DeadLetterAttemptHistoryRenderer,
  DeadLetterMessage,
} from "../../model/dead-letter-types.ts";
import { DeadLetterRow } from "./dead-letter-row.tsx";

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
    <Card.Root borderColor="border.muted" boxShadow="none">
      <Card.Body padding={0}>
        <ListTable
          density="compact"
          columnRules={false}
          containerProps={{ overflowX: "auto" }}
          size="sm"
          variant="line"
        >
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
        </ListTable>
      </Card.Body>
    </Card.Root>
  );
}
