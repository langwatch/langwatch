/** Live and recent agent sessions across every operator, newest first, each live one revocable. */

import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, Text } from "@langwatch/design-system/primitives";
import type { StaffAccessSessionView } from "@langwatch/staff-access-contract";
import { ShieldCheck } from "lucide-react";

import { STATUS_LABEL } from "../../model/staff-access-copy.ts";
import { ScopeBadges } from "../elements/scope-list.tsx";

const STATUS_PALETTE = {
  pending: "orange",
  approved: "blue",
  redeemed: "green",
  denied: "gray",
  expired: "gray",
  revoked: "red",
} as const;

export function SessionsTable({
  sessions,
  isRevocable,
  onRevoke,
}: {
  sessions: readonly StaffAccessSessionView[];
  isRevocable: (session: StaffAccessSessionView) => boolean;
  onRevoke: (session: StaffAccessSessionView) => void;
}) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel="Agent sessions">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Organization</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Access</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Reason</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Approver and machine</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Ends</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {sessions.length === 0 ? (
          <ListTable.SpanRow columns={7}>
            <NoDataInfoBlock
              icon={<ShieldCheck />}
              title="No agent sessions yet."
              description="Requests and live sessions from every operator's agents show here."
            />
          </ListTable.SpanRow>
        ) : null}
        {sessions.map((session) => (
          <ListTable.Row key={session.requestId} data-testid="staff-access-session-row">
            <ListTable.Cell>
              <Text truncate>{session.organizationName ?? "All organizations"}</Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <ScopeBadges scopes={session.scopes} />
            </ListTable.Cell>
            <ListTable.Cell>
              <Text textStyle="bodySm" lineClamp={2} title={session.reason}>
                {session.reason}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text textStyle="bodySm" truncate>
                {session.ownerEmail ?? "Unknown operator"}
              </Text>
              <Text textStyle="xs" color="fg.muted" truncate title={session.machine}>
                {session.machine}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <FormattedDate
                value={session.revokedAt ?? session.accessExpiresAt ?? session.expiresAt}
                display="relative"
              />
            </ListTable.Cell>
            <ListTable.Cell>
              <Badge size="sm" variant="subtle" colorPalette={STATUS_PALETTE[session.status]}>
                {STATUS_LABEL[session.status]}
              </Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              {isRevocable(session) ? (
                <Button size="sm" variant="outline" onClick={() => onRevoke(session)}>
                  Revoke
                </Button>
              ) : null}
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
