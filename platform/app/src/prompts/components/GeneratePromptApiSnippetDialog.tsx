import { HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import { Link } from "~/components/ui/link";
import { API_KEYS_SETTINGS_PATH } from "~/pages/settings/api-keys/apiKeyAnchor";
import type { PromptSnippetVariable } from "../utils/snippets/getGetPromptSnippets";
import { getGetPromptSnippets } from "../utils/snippets/getGetPromptSnippets";

/**
 * Full-length stand-in for a key the project does not have yet. Full length on
 * purpose: a short `sk-lw-xxx` reads like a real value that someone can paste,
 * and they only find out it is not when their SDK rejects it. Copying is
 * switched off while this is what the snippet carries.
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

/**
 * GeneratePromptApiSnippetDialog
 *
 * Renders an icon-only button that, when clicked, opens a modal (Dialog)
 * showing how to get this prompt and compile it.
 *
 * Single Responsibility: this component turns the prompt the reader has open
 * into snippets, and hands presentation to GenerateApiSnippetDialog.
 */
export function GeneratePromptApiSnippetDialog({
  promptHandle,
  apiKey,
  label,
  variables,
  children,
  open,
  onOpenChange,
}: GeneratePromptApiSnippetButtonProps) {
  // Memoized: GenerateApiSnippetDialog used to sync state via an effect keyed
  // on `snippets`, so a fresh array identity every render caused infinite
  // re-render loops. That effect is gone; keeping the identity stable while
  // the inputs are unchanged still spares reference-sensitive consumers
  // (memo comparisons, effect deps) from reacting to a rebuilt array.
  //
  // Keyed on the serialized variables rather than the array itself: callers
  // read them out of form state and hand over a fresh array on every render,
  // which would defeat the memo entirely.
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

  const targets = useMemo(
    () => snippets.map((snippet) => snippet.target),
    [snippets],
  );

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
      <Text color="fg.muted">
        The snippet needs an API key before it will run.
      </Text>
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
