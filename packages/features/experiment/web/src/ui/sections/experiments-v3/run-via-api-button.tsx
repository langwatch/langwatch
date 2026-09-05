/**
 * "Run via API" dialog for the evaluations-v3 workbench.
 */
import { useShallow } from "zustand/react/shallow";

import { GenerateApiSnippetDialog } from "@langwatch/workflow-web/components/GenerateApiSnippetDialog";
import { DataSourcePicker } from "@langwatch/workflow-web/components/run-via-api/DataSourcePicker";
import { buildRunSnippet } from "@langwatch/workflow-web/components/run-via-api/runSnippets";
import { useRunViaApiTabs } from "@langwatch/workflow-web/components/run-via-api/useRunViaApiTabs";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import type { WorkflowField } from "@langwatch/workflow-contract";

import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store";

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
    typeof window !== "undefined" ? window.location.origin : "https://app.langwatch.ai";

  const { dataSource, setDataSource, tabs } = useRunViaApiTabs(({ lang, dataSource: source }) =>
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
      controls={<DataSourcePicker value={dataSource} onChange={setDataSource} />}
      title="Run via API"
      description="Trigger this evaluation through the LangWatch API and read the per-row results back."
    />
  );
}

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
