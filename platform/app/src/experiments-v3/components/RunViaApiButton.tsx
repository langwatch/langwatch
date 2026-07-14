/**
 * "Run via API" dialog for the evaluations-v3 workbench.
 *
 * Opened from the workbench settings menu ("Run in CI/CD"). Targets the
 * experiment run endpoint via the SDK (`langwatch.experiment.run` /
 * `experiments.runWithResults` / `POST /api/experiments/{slug}/run`). Offers a
 * language picker (Python, TypeScript, Shell) and a data-source picker (attached
 * dataset, inline data, dataset id), and always shows how to read the per-row
 * results back.
 *
 * Controlled: the caller owns the open state so the dialog can be triggered from
 * a menu item that closes its popover as it opens. Presentational: it reads
 * nothing from the execution path. The container feeds it slug + columns from
 * the evaluations-v3 store.
 */
import { useShallow } from "zustand/react/shallow";

import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import { DataSourcePicker } from "~/components/run-via-api/DataSourcePicker";
import { buildRunSnippet } from "~/components/run-via-api/runSnippets";
import { useRunViaApiTabs } from "~/components/run-via-api/useRunViaApiTabs";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { WorkflowField } from "~/optimization_studio/utils/workflowFields";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

export function RunViaApiDialog({
  open,
  onOpenChange,
  experimentSlug,
  entryFields,
  datasetColumns,
  datasetName,
  projectSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experimentSlug: string;
  entryFields: WorkflowField[];
  datasetColumns: string[];
  datasetName?: string;
  projectSlug?: string;
}) {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.langwatch.ai";

  const { dataSource, setDataSource, tabs } = useRunViaApiTabs(
    ({ lang, dataSource: source }) =>
      buildRunSnippet({
        kind: "experiment",
        identifier: experimentSlug,
        baseUrl,
        entryFields,
        datasetColumns,
        datasetName,
        dataSource: source,
        projectSlug,
        lang,
      }),
  );

  return (
    <GenerateApiSnippetDialog
      open={open}
      onOpenChange={onOpenChange}
      snippets={[]}
      targets={[]}
      tabs={tabs}
      controls={
        <DataSourcePicker value={dataSource} onChange={setDataSource} />
      }
      title="Run via API"
      description="Trigger this evaluation through the LangWatch API and read the per-row results back."
    />
  );
}

/**
 * Page-level wrapper: reads the experiment slug and the active dataset (name +
 * columns) from the evaluations-v3 store, then renders the presentational
 * dialog controlled by the caller. The active dataset's columns are the
 * experiment's inputs, so they serve as both the entry fields and the dataset
 * columns.
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

  const activeDataset =
    datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0];
  const columnNames = activeDataset?.columns.map((column) => column.name) ?? [];
  const entryFields: WorkflowField[] = columnNames.map((name) => ({
    identifier: name,
    type: "str",
  }));

  return (
    <RunViaApiDialog
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
