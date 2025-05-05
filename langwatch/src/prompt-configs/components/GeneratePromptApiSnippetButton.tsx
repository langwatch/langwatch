import React from "react";
import { GenerateApiSnippetButton } from "~/components/GenerateApiSnippetButton";
import { generateGetPromptApiSnippets } from "../utils/generatePromptApiSnippet";

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
  const { snippets, targets } = generateGetPromptApiSnippets() ?? {};

  if (!snippets || !targets) {
    return null;
  }

  console.log(snippets);

  const snippetsWithValues = snippets.map((snippet) => ({
    ...snippet,
    content: snippet.content
      .replace("%7Bid%7D", configId)
      .replace("REPLACE_KEY_VALUE", "API_KEY"),
  }));

  return (
    <GenerateApiSnippetButton snippets={snippetsWithValues} targets={targets} />
  );
}
