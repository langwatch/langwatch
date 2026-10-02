/** "Run via API" for an evaluations-v3 experiment, lent to the experiment workbench. */

import type { UiRunExperimentViaApiDialogProps } from "@langwatch/browser-host/declarations";

import { buildRunSnippet } from "../../../model/run-via-api/run-snippets.ts";
import { DataSourcePicker } from "../../elements/run-via-api/data-source-picker.tsx";
import { GenerateApiSnippetDialog } from "../generate-api-snippet-dialog.tsx";
import { useRunViaApiTabs } from "./use-run-via-api-tabs.ts";

export function RunExperimentViaApiDialog({
  open,
  onOpenChange,
  experimentSlug,
  entryFields,
  datasetColumns,
  datasetName,
  projectSlug,
}: UiRunExperimentViaApiDialogProps) {
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
