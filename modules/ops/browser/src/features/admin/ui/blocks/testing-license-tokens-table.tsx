import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, Text } from "@langwatch/design-system/primitives";
import { Inbox } from "lucide-react";

import {
  TOKEN_STATUS_COLORS,
  tokenDisplayName,
  type TestingLicenseToken,
} from "../../model/testing-license-token.ts";
import { AdminDate, EmptyCell } from "../elements/admin-cells.tsx";
import { ShortId } from "../elements/short-id.tsx";

const COLUMN_COUNT = 8;

export function TestingLicenseTokensTable({
  tokens,
  isLoading,
  onRevoke,
}: {
  tokens: TestingLicenseToken[];
  isLoading: boolean;
  onRevoke: (token: TestingLicenseToken) => void;
}) {
  return (
    <ListTable
      variant="embedded"
      density="compact"
      scroll="x"
      scrollLabel="Testing license tokens table"
    >
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Kind</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Expires</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Revoked</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {tokens.length === 0 && !isLoading ? <EmptyRow /> : null}
        {tokens.map((token) => (
          <ListTable.Row key={token.id}>
            <ListTable.Cell>
              <Text fontWeight="medium">{tokenDisplayName(token)}</Text>
            </ListTable.Cell>
            <ListTable.Cell>{token.kind}</ListTable.Cell>
            <ListTable.Cell>
              <ShortId id={token.ownerUserId} />
            </ListTable.Cell>
            <ListTable.Cell>
              <AdminDate value={token.expiresAt} display="date" />
            </ListTable.Cell>
            <ListTable.Cell>
              {token.lastUsedAt ? (
                <AdminDate value={token.lastUsedAt} display="datetime" />
              ) : (
                <EmptyCell>never used</EmptyCell>
              )}
            </ListTable.Cell>
            <ListTable.Cell>
              <Badge colorPalette={TOKEN_STATUS_COLORS[token.status]}>{token.status}</Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              {token.revokedAt ? (
                <AdminDate value={token.revokedAt} display="date" />
              ) : (
                <EmptyCell>no</EmptyCell>
              )}
            </ListTable.Cell>
            <ListTable.Cell>
              {token.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  color="fg.error"
                  aria-label={`Revoke ${tokenDisplayName(token)}`}
                  onClick={() => onRevoke(token)}
                >
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

function EmptyRow() {
  return (
    <ListTable.SpanRow columns={COLUMN_COUNT}>
      <NoDataInfoBlock
        icon={<Inbox />}
        title="No testing license tokens yet."
        description="Personal tokens appear when a developer signs in; create a service token for CI."
      />
    </ListTable.SpanRow>
  );
}
