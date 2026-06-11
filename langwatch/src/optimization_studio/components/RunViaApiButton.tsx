import { Button } from "@chakra-ui/react";
import { Terminal } from "react-feather";

import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import type { Snippet } from "~/prompts/types";

function evaluateCurlSnippet(workflowId: string, baseUrl: string): string {
  return `curl -X POST "${baseUrl}/api/workflows/${workflowId}/evaluate" \\
  -H "X-Auth-Token: \${LANGWATCH_API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "parameters": { "feature_flag": "variant-b" }
  }'

# => { "run_id": "run_...", "workflow_version_id": "..." }
# Optional body fields: "version_id" (defaults to the latest committed
# version), "evaluate_on" (defaults to "full"), and "parameters", which
# bind as constant entry inputs on every dataset row.`;
}

/**
 * Shows how to trigger this workflow's evaluation from CI or scripts:
 * the same run the Evaluate button starts, via the REST API.
 */
export function RunViaApiButton({ workflowId }: { workflowId: string }) {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.langwatch.ai";

  const snippets: Snippet[] = [
    {
      target: "shell_curl",
      title: "curl",
      content: evaluateCurlSnippet(workflowId, baseUrl),
    },
  ];

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={["shell_curl"]}
      title="Run via API"
      description="Trigger this workflow's evaluation from CI or scripts, with optional parameters bound to every row."
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
