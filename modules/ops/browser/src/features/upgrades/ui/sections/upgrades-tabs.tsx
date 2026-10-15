import { ListTable } from "@langwatch/design-system/list-table";
import { Table, Tabs, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import type { UpgradeTargetSummaryView } from "../../model/upgrade-view.ts";
import { UpgradeErrorSummary } from "../elements/upgrade-error-summary.tsx";

/** The query key naming the open tab; the overview is the bare address. */
export const UPGRADES_TAB_PARAM = "tab";

/** The ledger's name for the shared ClickHouse target, which is not a dataplane. */
const SHARED_TARGET = "shared";

/** The targets that are private dataplanes: every one but the shared target. */
export function privateTargetsOf(
  targets: readonly UpgradeTargetSummaryView[],
): UpgradeTargetSummaryView[] {
  return targets.filter((target) => target.target !== SHARED_TARGET);
}

/** The Dataplanes table's rows: the shared target first, then each private one (T7-F5). */
function sharedFirst(targets: readonly UpgradeTargetSummaryView[]): UpgradeTargetSummaryView[] {
  return [
    ...targets.filter((target) => target.target === SHARED_TARGET),
    ...privateTargetsOf(targets),
  ];
}

export type UpgradesTab = "overview" | "runs" | "steps" | "organizations" | "dataplanes";

/** The tab an address names; anything unknown, or Dataplanes with no target, opens the overview. */
export function parseUpgradesTab({
  value,
  hasTargets,
}: {
  value: string | undefined;
  hasTargets: boolean;
}): UpgradesTab {
  if (value === "runs" || value === "steps" || value === "organizations") return value;
  if (value === "dataplanes" && hasTargets) return value;
  return "overview";
}

/** What the Route column says: a refused private target names why. */
const ROUTE_TEXT: Record<UpgradeTargetSummaryView["route"], string> = {
  present: "Present",
  missing: "Missing: organization refused",
  malformed: "Malformed: organization refused",
};

function TargetsTable({ targets }: { targets: readonly UpgradeTargetSummaryView[] }) {
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-dataplanes"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Target</Table.ColumnHeader>
          <Table.ColumnHeader>Route</Table.ColumnHeader>
          <Table.ColumnHeader>Version</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Outstanding</Table.ColumnHeader>
          <Table.ColumnHeader>Last error</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {targets.map((target) => (
          <Table.Row key={target.target} data-testid={`upgrade-dataplane-${target.target}`}>
            <Table.Cell fontFamily="mono">{target.target}</Table.Cell>
            <Table.Cell data-testid={`upgrade-dataplane-route-${target.target}`}>
              <Text textStyle="sm" color={target.route === "present" ? "fg.muted" : "fg.error"}>
                {ROUTE_TEXT[target.route]}
              </Text>
            </Table.Cell>
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

/** Overview, Runs, Steps and Organizations, plus Dataplanes when a private target exists. */
export function UpgradesTabs({
  targets: allTargets,
  overview,
  runs,
  steps,
  organizations,
  tab,
  onSelectTab,
}: {
  targets: readonly UpgradeTargetSummaryView[];
  overview: ReactNode;
  runs: ReactNode;
  steps: ReactNode;
  organizations: ReactNode;
  /** The open tab, when the address names it; otherwise the tabs keep their own. */
  tab?: UpgradesTab;
  onSelectTab?: (next: UpgradesTab) => void;
}) {
  const targets = privateTargetsOf(allTargets);
  return (
    <Tabs.Root
      {...(tab ? { value: tab } : { defaultValue: "overview" })}
      onValueChange={(event) => {
        const next = parseUpgradesTab({ value: event.value, hasTargets: targets.length > 0 });
        onSelectTab?.(next);
      }}
      variant="line"
      colorPalette="accent"
      width="full"
      lazyMount
      unmountOnExit
    >
      <Tabs.List marginBottom={5} overflowX="auto">
        <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
        <Tabs.Trigger value="runs">Runs</Tabs.Trigger>
        <Tabs.Trigger value="steps">Steps</Tabs.Trigger>
        <Tabs.Trigger value="organizations">Organizations</Tabs.Trigger>
        {targets.length > 0 && <Tabs.Trigger value="dataplanes">Dataplanes</Tabs.Trigger>}
      </Tabs.List>
      <Tabs.Content value="overview" padding={0}>
        {overview}
      </Tabs.Content>
      <Tabs.Content value="runs" padding={0}>
        {runs}
      </Tabs.Content>
      <Tabs.Content value="steps" padding={0}>
        {steps}
      </Tabs.Content>
      <Tabs.Content value="organizations" padding={0}>
        {organizations}
      </Tabs.Content>
      {targets.length > 0 && (
        <Tabs.Content value="dataplanes" padding={0}>
          <TargetsTable targets={sharedFirst(allTargets)} />
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
