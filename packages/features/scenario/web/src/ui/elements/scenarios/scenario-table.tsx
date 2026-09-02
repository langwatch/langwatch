import {
  ScenarioTable as ScenarioTableView,
  type ScenarioListItem,
} from "../../../index";
import type { ColumnFiltersState, RowSelectionState } from "@tanstack/react-table";
import { LangyContextTarget } from "@langwatch/langy-web";
import { scenarioContextChip } from "@langwatch/langy-web";
import type { Scenario } from "../../../model/prisma-types";
import { formatTimeAgo } from "@langwatch/workflow-web/utils/formatTimeAgo";
import { TagList } from "../tag-list";

export type ScenarioTableProps = {
  scenarios: Scenario[];
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange(filters: ColumnFiltersState): void;
  onRowClick(scenarioId: string): void;
  rowSelection: RowSelectionState;
  onRowSelectionChange(selection: RowSelectionState): void;
  onArchive(scenario: Scenario): void;
};

function toScenarioListItem(scenario: Scenario): ScenarioListItem {
  return {
    id: scenario.id,
    name: scenario.name,
    labels: scenario.labels,
    updatedAt: scenario.updatedAt,
  };
}

export function ScenarioTable({ scenarios, onArchive, ...props }: ScenarioTableProps) {
  const scenarioItems = scenarios.map(toScenarioListItem);

  return (
    <ScenarioTableView
      {...props}
      scenarios={scenarioItems}
      formatUpdatedAt={(updatedAt) => formatTimeAgo(updatedAt.getTime()) ?? ""}
      renderLabels={(labels) => <TagList labels={labels} />}
      renderRow={(scenario, row) => (
        <LangyContextTarget
          key={scenario.id}
          target={scenarioContextChip({
            scenarioId: scenario.id,
            name: scenario.name,
            noun: "scenario",
          })}
        >
          {row}
        </LangyContextTarget>
      )}
      onArchive={(scenario) => {
        const sourceScenario = scenarios.find(({ id }) => id === scenario.id);
        if (sourceScenario) {
          onArchive(sourceScenario);
        }
      }}
    />
  );
}
