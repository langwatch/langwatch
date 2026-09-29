import { Badge, Button, Table, Text, VStack } from "@chakra-ui/react";

import { ACTIVATION_CODE_STATUS_COLORS, type ActivationCode } from "../../model/activation-code.ts";
import { EmptyCell, formatDate } from "../elements/backoffice-cells.tsx";

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
    <Table.Root variant="line" size="md">
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
                  size="xs"
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
    </Table.Root>
  );
}

function EmptyRow() {
  return (
    <Table.Row>
      <Table.Cell colSpan={COLUMN_COUNT}>
        <Text color="fg.muted" fontSize="sm">
          No activation codes issued yet.
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}
