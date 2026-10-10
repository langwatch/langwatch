import { ListTable } from "@langwatch/design-system/list-table";
import { Table, Tabs, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { UpgradeTargetSummaryView } from "../../model/upgrade-view.ts";
import { UpgradeErrorSummary } from "../elements/upgrade-error-summary.tsx";

/** The query key naming the open tab; the overview is the bare address. */
export const UPGRADES_TAB_PARAM = "tab";

export type UpgradesTab = "overview" | "tenants" | "dataplanes";

/** The tab an address names; anything unknown, or Dataplanes with no target, opens the overview. */
export function parseUpgradesTab({
  value,
  hasTargets,
}: {
  value: string | undefined;
  hasTargets: boolean;
}): UpgradesTab {
  if (value === "tenants") return value;
  if (value === "dataplanes" && hasTargets) return value;
  return "overview";
}

function TargetsTable({ targets }: { targets: readonly UpgradeTargetSummaryView[] }) {
  return (
    <ListTable data-testid="upgrade-dataplanes">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Target</Table.ColumnHeader>
          <Table.ColumnHeader>Version</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Outstanding</Table.ColumnHeader>
          <Table.ColumnHeader>Last error</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {targets.map((target) => (
          <Table.Row key={target.target} data-testid={`upgrade-dataplane-${target.target}`}>
            <Table.Cell fontFamily="mono">{target.target}</Table.Cell>
            <Table.Cell fontFamily="mono">{target.version ?? "None"}</Table.Cell>
            <Table.Cell textAlign="end">{target.outstanding}</Table.Cell>
            <Table.Cell maxWidth="420px">
              {target.lastError ? (
                <UpgradeErrorSummary error={target.lastError} />
              ) : (
                <Text textStyle="sm" color="fg.muted">
                  None
                </Text>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}

/** Overview and Tenant migrations, plus Dataplanes when the ledger records a private target. */
export function UpgradesTabs({
  targets,
  overview,
  tenants,
  tab,
  onSelectTab,
}: {
  targets: readonly UpgradeTargetSummaryView[];
  overview: ReactNode;
  tenants: ReactNode;
  /** The open tab, when the address names it; otherwise the tabs keep their own. */
  tab?: UpgradesTab;
  onSelectTab?: (next: UpgradesTab) => void;
}) {
  return (
    <Tabs.Root
      {...(tab ? { value: tab } : { defaultValue: "overview" })}
      onValueChange={(event) => {
        const next = parseUpgradesTab({ value: event.value, hasTargets: targets.length > 0 });
        onSelectTab?.(next);
      }}
      colorPalette="orange"
      width="full"
      lazyMount
      unmountOnExit
    >
      <Tabs.List marginBottom={6} gap={6}>
        <Tabs.Trigger value="overview" paddingX={0}>
          Overview
        </Tabs.Trigger>
        <Tabs.Trigger value="tenants" paddingX={0}>
          Tenant migrations
        </Tabs.Trigger>
        {targets.length > 0 && (
          <Tabs.Trigger value="dataplanes" paddingX={0}>
            Dataplanes
          </Tabs.Trigger>
        )}
      </Tabs.List>
      <Tabs.Content value="overview" padding={0}>
        {overview}
      </Tabs.Content>
      <Tabs.Content value="tenants" padding={0}>
        {tenants}
      </Tabs.Content>
      {targets.length > 0 && (
        <Tabs.Content value="dataplanes" padding={0}>
          <TargetsTable targets={targets} />
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
