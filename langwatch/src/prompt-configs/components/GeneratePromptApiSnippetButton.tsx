import React from "react";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { generateGetPromptApiSnippets } from "../utils/generatePromptApiSnippet";
import { getGetPromptSnippets } from "../utils/snippets";

interface GeneratePromptApiSnippetButtonProps {
  configId: string;
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
}: GeneratePromptApiSnippetButtonProps) {
  // const { snippets, targets } = generateGetPromptApiSnippets() ?? {};
  const snippets = getGetPromptSnippets({
    promptId: configId,
    apiKey: "API_KEY",
  });
  const targets = snippets.map((snippet) => snippet.target);

  if (!snippets) {
    return null;
  }

  const snippetsWithValues = snippets.map((snippet) => ({
    ...snippet,
    content: snippet.content
      .replace("%7Bid%7D", configId)
      .replace("REPLACE_KEY_VALUE", "API_KEY"),
  }));

  return (
    <GenerateApiSnippetButton
      snippets={snippetsWithValues}
      targets={targets}
      variables={{
        id: configId,
        apiKey: "API_KEY",
      }}
    />
  );
}
