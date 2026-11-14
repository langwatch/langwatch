/** The signed-in operator's enrolled agents, each with its revoke. */

import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, Text } from "@langwatch/design-system/primitives";
import type { StaffAccessRequesterView } from "@langwatch/staff-access-contract";
import { Bot } from "lucide-react";

export function RequestersTable({
  requesters,
  onRevoke,
}: {
  requesters: readonly StaffAccessRequesterView[];
  onRevoke: (requester: StaffAccessRequesterView) => void;
}) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel="Your agents">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Enrolled</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Key expires</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {requesters.length === 0 ? (
          <ListTable.SpanRow columns={5}>
            <NoDataInfoBlock
              icon={<Bot />}
              title="No agents enrolled yet."
              description="Enrol the coding agent you work with, then it can ask you for access."
            />
          </ListTable.SpanRow>
        ) : null}
        {requesters.map((requester) => (
          <ListTable.Row key={requester.id} data-testid="staff-access-requester-row">
            <ListTable.Cell>
              <Text textStyle="label">{requester.name}</Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <FormattedDate value={requester.createdAt} display="date" />
            </ListTable.Cell>
            <ListTable.Cell>
              <FormattedDate value={requester.expiresAt} display="date" />
            </ListTable.Cell>
            <ListTable.Cell>
              {requester.lastUsedAt ? (
                <FormattedDate value={requester.lastUsedAt} display="relative" />
              ) : (
                <Text color="fg.muted">Never</Text>
              )}
            </ListTable.Cell>
            <ListTable.Cell>
              {requester.revokedAt ? (
                <Badge size="sm" variant="subtle">
                  Revoked
                </Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onRevoke(requester)}>
                  Revoke
                </Button>
              )}
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
