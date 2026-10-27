import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, Text, VStack } from "@langwatch/design-system/primitives";
import { Inbox } from "lucide-react";

import { ACTIVATION_CODE_STATUS_COLORS, type ActivationCode } from "../../model/activation-code.ts";
import { AdminDate, EmptyCell } from "../elements/admin-cells.tsx";

const COLUMN_COUNT = 8;

export function ActivationCodesTable({
  codes,
  isLoading,
  isRevoking,
  onRevoke,
}: {
  codes: ActivationCode[];
  isLoading: boolean;
  isRevoking: boolean;
  onRevoke: (code: ActivationCode) => void;
}) {
  return (
    <ListTable variant="embedded" density="compact" scroll="x" scrollLabel="Activation codes table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Customer</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Code</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Plan</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Seats</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Code expires</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Use</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {codes.length === 0 && !isLoading ? <EmptyRow /> : null}
        {codes.map((code) => (
          <ListTable.Row key={code.id}>
            <ListTable.Cell>
              <VStack align="start" gap={0}>
                <Text fontWeight="medium">{code.organizationName}</Text>
                <Text fontSize="xs" color="fg.muted">
                  {code.email}
                </Text>
              </VStack>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text fontFamily="mono" fontSize="sm">
                ...{code.codeHint}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>{code.planType}</ListTable.Cell>
            <ListTable.Cell>{code.maxMembers}</ListTable.Cell>
            <ListTable.Cell>
              <AdminDate value={code.expiresAt} display="date" />
            </ListTable.Cell>
            <ListTable.Cell>
              {code.reusable ? (
                <Text fontSize="sm">reusable, {code.redemptionCount} so far</Text>
              ) : (
                <EmptyCell>single use</EmptyCell>
              )}
            </ListTable.Cell>
            <ListTable.Cell>
              <Badge colorPalette={ACTIVATION_CODE_STATUS_COLORS[code.status]}>{code.status}</Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              {code.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  color="fg.error"
                  loading={isRevoking}
                  onClick={() => onRevoke(code)}
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
        title="No activation codes issued yet."
        description="Records will appear here when they are available."
      />
    </ListTable.SpanRow>
  );
}
