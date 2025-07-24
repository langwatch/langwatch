import { Text, VStack } from "@chakra-ui/react";
import React from "react";

import { getGetPromptSnippets } from "../utils/snippets/getGetPromptSnippets";

import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import { Link } from "~/components/ui/link";

interface GeneratePromptApiSnippetButtonProps {
  configId?: string;
  apiKey?: string;
  children?: React.ReactNode;
}

/**
 * GeneratePromptApiSnippetDialog
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * for displaying API code snippets for prompt usage.
 *
 * Single Responsibility: This component specifically handles prompt API snippet generation
 * and documentation display for the Get Prompt endpoint.
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

  if (!snippets) {
    return children;
  }

  const description = (
    <VStack alignItems="flex-start" gap={3} marginBottom={4}>
      <Text>
        Use the following API code snippets to interact with the prompt.
      </Text>
      <Link
        href="https://docs.langwatch.ai/api-reference/prompts/get-prompt"
        isExternal
        color="blue.500"
        _hover={{ textDecoration: "underline" }}
        fontSize="sm"
      >
        📖 View API documentation
      </Link>
    </VStack>
  );

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={targets}
      title="Get Prompt by ID"
      description={description}
    >
      {children}
    </GenerateApiSnippetDialog>
  );
}

// Re-export the Trigger subcomponent for composability
GeneratePromptApiSnippetDialog.Trigger = GenerateApiSnippetDialog.Trigger;
