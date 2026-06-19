/**
 * "Run via API" for the evaluations-v3 workbench.
 *
 * Mirrors the studio results-panel button but targets the experiment run
 * endpoint via the SDK (`langwatch.experiment.run` / `experiments.runWithResults`
 * / `POST /api/experiments/{slug}/run`). Offers a language picker (Python,
 * TypeScript, Shell) and a data-source picker (attached dataset, inline data,
 * dataset id), and always shows how to read the per-row results back.
 *
 * Additive and presentational: it reads nothing from the execution path. The
 * page-level wrapper (`RunViaApiButtonContainer`) feeds it slug + columns from
 * the evaluations-v3 store and router.
 */
import { Button } from "@chakra-ui/react";
import { Terminal } from "react-feather";
import { useShallow } from "zustand/react/shallow";

import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import { DataSourcePicker } from "~/components/run-via-api/DataSourcePicker";
import { buildRunSnippet } from "~/components/run-via-api/runSnippets";
import { useRunViaApiTabs } from "~/components/run-via-api/useRunViaApiTabs";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { WorkflowField } from "~/optimization_studio/utils/workflowFields";
import { useRouter } from "~/utils/compat/next-router";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

export function RunViaApiButton({
  experimentSlug,
  entryFields,
  datasetColumns,
  datasetName,
  projectSlug,
  disabled = false,
}: {
  experimentSlug: string;
  entryFields: WorkflowField[];
  datasetColumns: string[];
  datasetName?: string;
  projectSlug?: string;
  disabled?: boolean;
}) {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.langwatch.ai";

  const { dataSource, setDataSource, tabs } = useRunViaApiTabs((lang, source) =>
    buildRunSnippet(
      {
        kind: "experiment",
        identifier: experimentSlug,
        baseUrl,
        entryFields,
        datasetColumns,
        datasetName,
        dataSource: source,
        projectSlug,
      },
      lang,
    ),
  );

  return (
    <GenerateApiSnippetDialog
      snippets={[]}
      targets={[]}
      tabs={tabs}
      controls={
        <DataSourcePicker value={dataSource} onChange={setDataSource} />
      }
      title="Run via API"
      description="Trigger this evaluation through the LangWatch API and read the per-row results back."
    >
      <GenerateApiSnippetDialog.Trigger>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          data-testid="run-via-api-experiment"
        >
          <Terminal size={14} />
          Run via API
        </Button>
      </GenerateApiSnippetDialog.Trigger>
    </GenerateApiSnippetDialog>
  );
}

/**
 * Page-level wrapper: reads the experiment slug from the router and the active
 * dataset (name + columns) from the evaluations-v3 store, then renders the
 * presentational button. The active dataset's columns are the experiment's
 * inputs, so they serve as both the entry fields and the dataset columns.
 */
export function RunViaApiButtonContainer({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const slug = router.query.slug as string | undefined;
  const { project } = useOrganizationTeamProject();

  const { datasets, activeDatasetId } = useEvaluationsV3Store(
    useShallow((state) => ({
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
    })),
  );

  if (!slug) return null;

  const activeDataset =
    datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0];
  const columnNames = activeDataset?.columns.map((column) => column.name) ?? [];
  const entryFields: WorkflowField[] = columnNames.map((name) => ({
    identifier: name,
    type: "str",
  }));

  return (
    <RunViaApiButton
      experimentSlug={slug}
      entryFields={entryFields}
      datasetColumns={columnNames}
      datasetName={activeDataset?.name}
      projectSlug={project?.slug}
      disabled={disabled}
    />
  );
}
