// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { EmptyState, Table, Text } from "@langwatch/design-system/primitives";
import type { SecurityLakeCaller } from "@langwatch/enterprise-governance-contract";

type Caller = SecurityLakeCaller;

/** Principals seen calling a model in Security Lake in the last 30 days that send no traces. */
export function SecurityLakeCallersList({
  hasSource,
  callers,
}: {
  hasSource: boolean;
  callers: Caller[];
}) {
  if (!hasSource) {
    return (
      <EmptyState.Root size="sm">
        <EmptyState.Content>
          <EmptyState.Title>Connect a Security Lake source to see model callers</EmptyState.Title>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }
  if (callers.length === 0) {
    return (
      <EmptyState.Root size="sm">
        <EmptyState.Content>
          <EmptyState.Title>Every model caller sends traces</EmptyState.Title>
          <EmptyState.Description>
            Principals that call a model and send no traces show up here.
          </EmptyState.Description>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }
  return (
    <Table.Root size="sm" aria-label="Model callers without traces">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Principal</Table.ColumnHeader>
          <Table.ColumnHeader>Models</Table.ColumnHeader>
          <Table.ColumnHeader>Regions</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Calls</Table.ColumnHeader>
          <Table.ColumnHeader>Last call</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {callers.map((caller) => (
          <Table.Row key={caller.principalArn}>
            <Table.Cell>
              <Text fontFamily="mono" textStyle="xs">
                {caller.principalArn}
              </Text>
            </Table.Cell>
            <Table.Cell>{caller.models.join(", ")}</Table.Cell>
            <Table.Cell>{caller.regions.join(", ")}</Table.Cell>
            <Table.Cell textAlign="end">{caller.callCount}</Table.Cell>
            <Table.Cell>
              <FormattedDate value={caller.lastCallMs} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
