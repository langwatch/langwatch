import { Button } from "@chakra-ui/react";
import {
  buildRunSnippet,
  type RunSnippetDataSource,
  DataSourcePicker,
} from "@langwatch/workflow-browser-kit";
import type { WorkflowField } from "@langwatch/workflow-contract";
import { Terminal } from "react-feather";

import { type ApiSnippetTab, GenerateApiSnippetDialog } from "../generate-api-snippet-dialog.tsx";
import { useRunViaApiTabs } from "../run-via-api/use-run-via-api-tabs.ts";

/**
 * Shows how to trigger this workflow's evaluation from CI or scripts, via the
 * same evaluations-v3 backend the Evaluate button uses. Offers a language
 * picker and a data-source picker, and always shows reading results back.
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
    typeof window !== "undefined" ? window.location.origin : "https://app.langwatch.ai";

  const { dataSource, setDataSource, tabs } = useRunViaApiTabs(({ lang, dataSource: source }) =>
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
      controls={<DataSourcePicker value={dataSource} onChange={setDataSource} />}
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
