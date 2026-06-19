import { Button } from "@chakra-ui/react";
import { Terminal } from "react-feather";

import {
  type ApiSnippetTab,
  GenerateApiSnippetDialog,
} from "~/components/GenerateApiSnippetDialog";
import { DataSourcePicker } from "~/components/run-via-api/DataSourcePicker";
import {
  buildRunSnippet,
  type RunSnippetDataSource,
} from "~/components/run-via-api/runSnippets";
import { useRunViaApiTabs } from "~/components/run-via-api/useRunViaApiTabs";

import type { WorkflowField } from "../utils/workflowFields";

/**
 * Shows how to trigger this workflow's evaluation from CI or scripts: the same
 * run the Evaluate button starts, through the unified evaluations-v3 backend.
 * Offers a language picker (Python, TypeScript, Shell) and a data-source picker
 * (attached dataset, inline data, dataset id), and always shows how to read the
 * per-row results back. The example mirrors the entry point's own fields.
 */
export function RunViaApiButton({
  workflowId,
  entryFields,
  datasetColumns,
  datasetName,
  projectSlug,
}: {
  workflowId: string;
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
        kind: "workflow",
        identifier: workflowId,
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
      snippets={[]}
      targets={[]}
      tabs={tabs}
      controls={
        <DataSourcePicker value={dataSource} onChange={setDataSource} />
      }
      title="Run via API"
      description="Trigger this workflow's evaluation through the LangWatch API and read the per-row results back."
    >
      <GenerateApiSnippetDialog.Trigger>
        <Button size="sm" variant="outline" data-testid="run-via-api">
          <Terminal size={14} />
          Run via API
        </Button>
      </GenerateApiSnippetDialog.Trigger>
    </GenerateApiSnippetDialog>
  );
}

export type { ApiSnippetTab, RunSnippetDataSource };
