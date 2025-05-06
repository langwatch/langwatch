import React from "react";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { generateGetPromptApiSnippets } from "../utils/generatePromptApiSnippet";
import { getGetPromptSnippets } from "../utils/snippets";

interface GeneratePromptApiSnippetButtonProps {
  configId: string;
  apiKey?: string;
}

/**
 * GeneratePromptApiSnippetButton
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * for displaying API code snippets for prompt usage.
 *
 * - SRP: This component only handles the button and modal UI.
 * - The actual code snippet generation logic will be injected later.
 * - Uses Chakra v3 and react-feather icons as per project rules.
 */
export function GeneratePromptApiSnippetButton({
  configId,
  apiKey,
}: GeneratePromptApiSnippetButtonProps) {
  // const { snippets, targets } = generateGetPromptApiSnippets() ?? {};
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
      variables={{
        id: configId,
        apiKey,
      }}
    />
  );
}
