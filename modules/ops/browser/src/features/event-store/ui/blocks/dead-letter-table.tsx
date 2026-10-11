import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";

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
    <Card padding="none">
      <ListTable
        density="compact"
        variant="embedded"
        scroll="x"
        scrollLabel="Dead-lettered messages"
      >
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Process</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Intent</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Process key</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Attempts</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Retired</ListTable.ColumnHeader>
            <ListTable.ColumnHeader label="Actions" />
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
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
        </ListTable.Body>
      </ListTable>
    </Card>
  );
}
