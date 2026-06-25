import { Button } from "@chakra-ui/react";
import { Terminal } from "react-feather";

import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import type { Snippet } from "~/prompts/types";

import {
  evaluateCurlSnippet,
  evaluateGoSnippet,
} from "../utils/evaluateApiSnippet";
import type { WorkflowField } from "../utils/workflowFields";

/**
 * Shows how to trigger this workflow's evaluation from CI or scripts: the same
 * run the Evaluate button starts, via the REST API. The parameters example
 * mirrors the entry point's own fields so it is real for this workflow.
 */
export function RunViaApiButton({
  workflowId,
  entryFields,
  datasetColumns,
  datasetName,
}: {
  workflowId: string;
  entryFields: WorkflowField[];
  datasetColumns: string[];
  datasetName?: string;
}) {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.langwatch.ai";

  const snippets: Snippet[] = [
    {
      target: "shell_curl",
      title: "curl",
      content: evaluateCurlSnippet({
        workflowId,
        baseUrl,
        entryFields,
        datasetColumns,
        datasetName,
      }),
    },
    {
      target: "go_native",
      title: "Go",
      content: evaluateGoSnippet({
        workflowId,
        baseUrl,
        entryFields,
        datasetColumns,
        datasetName,
      }),
    },
  ];

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={["shell_curl", "go_native"]}
      title="Run via API"
      description="Trigger this workflow's evaluation from CI or scripts. It runs against the attached dataset; parameters below set constant inputs for fields the dataset does not provide."
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
