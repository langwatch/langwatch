import { Table, Text } from "@chakra-ui/react";
import { LicensesTableRow } from "./LicensesTableRow";
import type { License } from "./types";
import { useLicenseCommands } from "./useLicenseCommands";

const COLUMN_COUNT = 8;

export function LicensesTable({
  licenses,
  isLoading,
  onOpen,
  onRevoke,
}: {
  licenses: License[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onRevoke: (license: License) => void;
}) {
  const commands = useLicenseCommands();

  return (
    <Table.Root variant="line" size="md">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Customer</Table.ColumnHeader>
          <Table.ColumnHeader>Plan</Table.ColumnHeader>
          <Table.ColumnHeader>Seats</Table.ColumnHeader>
          <Table.ColumnHeader>Term ends</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader>Hosted services</Table.ColumnHeader>
          <Table.ColumnHeader>Instance</Table.ColumnHeader>
          <Table.ColumnHeader width="1%" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {licenses.length === 0 && !isLoading ? <EmptyRow /> : null}
        {licenses.map((license) => (
          <LicensesTableRow
            key={license.id}
            license={license}
            onOpen={() => onOpen(license.id)}
            onRevoke={() => onRevoke(license)}
            onResetBinding={() =>
              commands.resetInstanceBinding.mutate({ id: license.id })
            }
          />
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
          No licenses in the registry yet.
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}
