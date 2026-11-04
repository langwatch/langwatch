/** "Run via API" for an evaluations-v3 experiment, lent to the experiment workbench. */

import { HStack } from "@langwatch/design-system/primitives";
import type { RunExperimentViaApiDialogProps } from "@langwatch/workflow-client";
import { useState } from "react";

import {
  concurrencyOf,
  initialRunExecution,
  type RunExecution,
} from "../../../model/run-via-api/run-execution.ts";
import { buildRunSnippet, type RunSnippetLang } from "../../../model/run-via-api/run-snippets.ts";
import { DataSourcePicker } from "../../elements/run-via-api/data-source-picker.tsx";
import { ExecutionPicker } from "../../elements/run-via-api/execution-picker.tsx";
import { GenerateApiSnippetDialog } from "../generate-api-snippet-dialog.tsx";
import { API_LANGS, useRunViaApiTabs } from "./use-run-via-api-tabs.ts";

const EXPERIMENT_LANGS: RunSnippetLang[] = [...API_LANGS, "cli", "github_actions"];

export function RunExperimentViaApiDialog({
  open,
  onOpenChange,
  experimentSlug,
  entryFields,
  datasetColumns,
  datasetName,
  projectSlug,
  concurrency: savedConcurrency,
}: RunExperimentViaApiDialogProps) {
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://app.langwatch.ai";
  const [execution, setExecution] = useState<RunExecution>(() =>
    initialRunExecution({ savedConcurrency }),
  );
  const [executionFrom, setExecutionFrom] = useState(savedConcurrency);
  if (executionFrom !== savedConcurrency) {
    setExecutionFrom(savedConcurrency);
    setExecution(initialRunExecution({ savedConcurrency }));
  }

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
        concurrency: concurrencyOf(execution),
      }),
    EXPERIMENT_LANGS,
  );

  return (
    <GenerateApiSnippetDialog
      open={open}
      onOpenChange={onOpenChange}
      snippets={[]}
      targets={[]}
      tabs={tabs}
      controls={
        <HStack gap={4} flexWrap="wrap">
          <DataSourcePicker value={dataSource} onChange={setDataSource} />
          <ExecutionPicker value={execution} onChange={setExecution} />
        </HStack>
      }
      title="Run via API"
      description="Trigger this evaluation from a script or a CI pipeline and read the per-row results back. Sequential runs one cell at a time in row order."
    />
  );
}
