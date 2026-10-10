import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, Table, Text, VStack } from "@langwatch/design-system/primitives";
import { Inbox } from "lucide-react";

import { ACTIVATION_CODE_STATUS_COLORS, type ActivationCode } from "../../model/activation-code.ts";
import { EmptyCell, formatDate } from "../elements/admin-cells.tsx";

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
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      variant="line"
      size="sm"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Customer</Table.ColumnHeader>
          <Table.ColumnHeader>Code</Table.ColumnHeader>
          <Table.ColumnHeader>Plan</Table.ColumnHeader>
          <Table.ColumnHeader>Seats</Table.ColumnHeader>
          <Table.ColumnHeader>Code expires</Table.ColumnHeader>
          <Table.ColumnHeader>Use</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader width="1%" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {codes.length === 0 && !isLoading ? <EmptyRow /> : null}
        {codes.map((code) => (
          <Table.Row key={code.id}>
            <Table.Cell>
              <VStack align="start" gap={0}>
                <Text fontWeight="medium">{code.organizationName}</Text>
                <Text fontSize="xs" color="fg.muted">
                  {code.email}
                </Text>
              </VStack>
            </Table.Cell>
            <Table.Cell>
              <Text fontFamily="mono" fontSize="sm">
                ...{code.codeHint}
              </Text>
            </Table.Cell>
            <Table.Cell>{code.planType}</Table.Cell>
            <Table.Cell>{code.maxMembers}</Table.Cell>
            <Table.Cell>{formatDate(code.expiresAt)}</Table.Cell>
            <Table.Cell>
              {code.reusable ? (
                <Text fontSize="sm">reusable, {code.redemptionCount} so far</Text>
              ) : (
                <EmptyCell>single use</EmptyCell>
              )}
            </Table.Cell>
            <Table.Cell>
              <Badge colorPalette={ACTIVATION_CODE_STATUS_COLORS[code.status]}>{code.status}</Badge>
            </Table.Cell>
            <Table.Cell>
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
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

function EmptyRow() {
  return (
    <Table.Row>
      <Table.Cell colSpan={COLUMN_COUNT}>
        <NoDataInfoBlock
          icon={<Inbox />}
          title="No activation codes issued yet."
          description="Records will appear here when they are available."
        />
      </Table.Cell>
    </Table.Row>
  );
}
