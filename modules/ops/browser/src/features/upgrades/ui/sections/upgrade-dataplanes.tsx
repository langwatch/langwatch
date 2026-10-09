import { ListTable } from "@langwatch/design-system/list-table";
import { Table, Tabs, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { UpgradeTargetSummaryView } from "../../model/upgrade-view.ts";

function TargetsTable({ targets }: { targets: readonly UpgradeTargetSummaryView[] }) {
  return (
    <ListTable data-testid="upgrade-dataplanes">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Target</Table.ColumnHeader>
          <Table.ColumnHeader>Version</Table.ColumnHeader>
          <Table.ColumnHeader>Outstanding</Table.ColumnHeader>
          <Table.ColumnHeader>Last error</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {targets.map((target) => (
          <Table.Row key={target.target} data-testid={`upgrade-dataplane-${target.target}`}>
            <Table.Cell fontFamily="mono">{target.target}</Table.Cell>
            <Table.Cell fontFamily="mono">{target.version ?? "None"}</Table.Cell>
            <Table.Cell>{target.outstanding}</Table.Cell>
            <Table.Cell>
              <Text textStyle="sm" color={target.lastError ? "fg.error" : "fg.muted"}>
                {target.lastError ?? "None"}
              </Text>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** W7: the overview, plus a Dataplanes tab only when the ledger records a private target. */
export function UpgradeDataplanesTabs({
  targets,
  overview,
}: {
  targets: readonly UpgradeTargetSummaryView[];
  overview: ReactNode;
}) {
  if (targets.length === 0) return <>{overview}</>;
  return (
    <Tabs.Root defaultValue="overview" lazyMount>
      <Tabs.List>
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        <Tabs.Trigger value="dataplanes">Dataplanes</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="overview">{overview}</Tabs.Content>
      <Tabs.Content value="dataplanes">
        <TargetsTable targets={targets} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
