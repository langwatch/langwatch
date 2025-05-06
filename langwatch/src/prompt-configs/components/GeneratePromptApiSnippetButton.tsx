import React from "react";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { getGetPromptSnippets } from "../utils/snippets/getGetPromptSnippets";

interface GeneratePromptApiSnippetButtonProps {
  configId: string;
  apiKey?: string;
}

/**
 * GeneratePromptApiSnippetButton
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * for displaying API code snippets for prompt usage.
 */
export function GeneratePromptApiSnippetButton({
  configId,
  apiKey,
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
    <GenerateApiSnippetButton
      snippets={snippets}
      targets={targets}
      title="Get Prompt by ID"
    />
  );
}
