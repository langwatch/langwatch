import { HStack, Text } from "@chakra-ui/react";
import { getGetPromptSnippets, type PromptSnippetVariable } from "@langwatch/prompt-browser-kit";
import type React from "react";
import { useMemo } from "react";

import { Link } from "../../../../ui/elements/prompt-link.tsx";
import { GenerateApiSnippetDialog } from "./generate-api-snippet-dialog.tsx";

/** Where a reader goes to mint the key the snippet needs. */
const API_KEYS_SETTINGS_PATH = "/settings/api-keys";

/**
 * Full-length stand-in for a key the project doesn't have yet - on purpose:
 * a short `sk-lw-xxx` reads like a pasteable value until the SDK rejects it.
 * Copying is switched off while this is what the snippet carries.
 */
const PLACEHOLDER_API_KEY = "sk-lw-xxxxxxxxxxxxxxxxxxxxxxxx";

interface GeneratePromptApiSnippetButtonProps {
  promptHandle?: string | null;
  apiKey?: string;
  label?: string;
  /** The variables the prompt declares, in the order the editor shows them. */
  variables?: PromptSnippetVariable[];
  children?: React.ReactNode;
  /** Allows a compact toolbar menu to own the dialog trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function GeneratePromptApiSnippetDialog({
  promptHandle,
  apiKey,
  label,
  variables,
  children,
  open,
  onOpenChange,
}: GeneratePromptApiSnippetButtonProps) {
  // Keyed on the serialized variables rather than the array itself: callers
  // hand over a fresh array identity every render, which would defeat the
  // memo entirely.
  const variablesKey = JSON.stringify(variables ?? []);
  const snippets = useMemo(
    () =>
      getGetPromptSnippets({
        promptHandle: promptHandle ?? undefined,
        apiKey: apiKey ?? PLACEHOLDER_API_KEY,
        label,
        variables: JSON.parse(variablesKey) as PromptSnippetVariable[],
      }),
    [promptHandle, apiKey, label, variablesKey],
  );

  const targets = useMemo(() => snippets.map((snippet) => snippet.target), [snippets]);

  if (!snippets) {
    return children;
  }

  const description = (
    <Link
      href="https://docs.langwatch.ai/api-reference/prompts/get-prompt"
      isExternal
      color="blue.fg"
      _hover={{ textDecoration: "underline" }}
      fontSize="xs"
    >
      View the API documentation
    </Link>
  );

  const controls = apiKey ? null : (
    <HStack gap={2} fontSize="sm">
      <Text color="fg.muted">The snippet needs an API key before it will run.</Text>
      <Link href={API_KEYS_SETTINGS_PATH} color="blue.fg">
        Create an API key
      </Link>
    </HStack>
  );

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={targets}
      title="Get and use this prompt"
      description={description}
      controls={controls}
      sensitiveValue={apiKey}
      copyDisabled={!apiKey}
      open={open}
      onOpenChange={onOpenChange}
    >
      {children}
    </GenerateApiSnippetDialog>
  );
}

// Re-export the Trigger subcomponent for composability
GeneratePromptApiSnippetDialog.Trigger = GenerateApiSnippetDialog.Trigger;
