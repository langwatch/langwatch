import { createDataGridStore } from "~/components/ui/datagrid/useDataGridStore";
import type { DataGridConfig } from "~/components/ui/datagrid/types";
import type { ScenarioRunRow } from "./types";

/**
 * Factory function to create a scenarios table store
 * This should be called once at module level or in a context provider
 */
export function createScenariosTableStore(config: Omit<DataGridConfig<ScenarioRunRow>, "getRowId">) {
  return createDataGridStore<ScenarioRunRow>({
    ...config,
    getRowId: (row) => row.scenarioRunId,
  });
}

/**
 * Type for the scenarios table store
 */
export type ScenariosTableStore = ReturnType<typeof createScenariosTableStore>;

