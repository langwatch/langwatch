import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import type { WorkflowField } from "@langwatch/workflow-contract";
/**
 * "Run via API" dialog for the evaluations-v3 workbench.
 */
import { useShallow } from "zustand/react/shallow";

import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { RunExperimentViaApiDialog } from "../../../behavior/lent-workflow.tsx";

/**
 * Page-level wrapper: reads the experiment slug and the active dataset (name + columns)
 * from the evaluations-v3 store, then renders the presentational dialog controlled by
 * the caller.
 */
export function RunViaApiDialogContainer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { project } = useOrganizationTeamProject();

  const { experimentSlug, datasets, activeDatasetId } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentSlug: state.experimentSlug,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
    })),
  );

  if (!experimentSlug) return null;

  const activeDataset = datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0];
  const columnNames = activeDataset?.columns.map((column) => column.name) ?? [];
  const entryFields: WorkflowField[] = columnNames.map((name) => ({
    identifier: name,
    type: "str",
  }));

  return (
    <RunExperimentViaApiDialog
      open={open}
      onOpenChange={onOpenChange}
      experimentSlug={experimentSlug}
      entryFields={entryFields}
      datasetColumns={columnNames}
      datasetName={activeDataset?.name}
      projectSlug={project?.slug}
    />
  );
}
