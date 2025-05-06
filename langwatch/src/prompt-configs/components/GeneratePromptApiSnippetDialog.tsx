import React from "react";
import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import { getGetPromptSnippets } from "../utils/snippets/getGetPromptSnippets";

interface GeneratePromptApiSnippetButtonProps {
  configId: string;
  apiKey?: string;
  children?: React.ReactNode;
}

/**
 * GeneratePromptApiSnippetDialog
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * for displaying API code snippets for prompt usage.
 */
export function GeneratePromptApiSnippetDialog({
  configId,
  apiKey,
  children,
}: GeneratePromptApiSnippetButtonProps) {
  const snippets = getGetPromptSnippets({
    promptId: configId,
    apiKey,
  });

  const targets = snippets.map((snippet) => snippet.target);

  if (!snippets || !apiKey) {
    return null;
  }

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={targets}
      title="Get Prompt by ID"
      description="Use the following API code snippets to interact with the prompt."
    >
      {children}
    </GenerateApiSnippetDialog>
  );
}

// Re-export the Trigger subcomponent for composability
GeneratePromptApiSnippetDialog.Trigger = GenerateApiSnippetDialog.Trigger;
