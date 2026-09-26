import { Table, Text } from "@chakra-ui/react";
import { InstancesTableRow } from "./InstancesTableRow";
import type { SelfHostedInstance } from "./types";

const COLUMN_COUNT = 8;

export function InstancesTable({
  instances,
  isLoading,
  onOpen,
}: {
  instances: SelfHostedInstance[];
  isLoading: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <Table.Root variant="line" size="md">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Install</Table.ColumnHeader>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Activity</Table.ColumnHeader>
          <Table.ColumnHeader>Last report</Table.ColumnHeader>
          <Table.ColumnHeader>First seen</Table.ColumnHeader>
          <Table.ColumnHeader>Size</Table.ColumnHeader>
          <Table.ColumnHeader>Last 28 days</Table.ColumnHeader>
          <Table.ColumnHeader>License</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {instances.length === 0 && !isLoading ? <EmptyRow /> : null}
        {instances.map((instance) => (
          <InstancesTableRow
            key={instance.id}
            instance={instance}
            onOpen={() => onOpen(instance.id)}
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
          No self-hosted install has reported yet.
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}
