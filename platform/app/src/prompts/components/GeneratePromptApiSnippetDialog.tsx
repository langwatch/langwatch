import { VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import { MintApiKeyBanner } from "~/components/api-keys/MintApiKeyBanner";
import { GenerateApiSnippetDialog } from "~/components/GenerateApiSnippetDialog";
import { Link } from "~/components/ui/link";
import { useMintProjectApiKey } from "~/hooks/useMintProjectApiKey";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getGetPromptSnippets } from "../utils/snippets/getGetPromptSnippets";

interface GeneratePromptApiSnippetButtonProps {
  promptHandle?: string | null;
  label?: string;
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
 *
 * The snippets show a placeholder key until the reader mints one from the
 * dialog: the project's own key is stored as a hash and cannot be shown.
 */
export function GeneratePromptApiSnippetDialog({
  promptHandle,
  label,
  children,
}: GeneratePromptApiSnippetButtonProps) {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const mintKey = useMintProjectApiKey({
    organizationId: organization?.id,
    projectId: project?.id,
  });
  const apiKey = mintKey.token ?? undefined;

  // Memoized: GenerateApiSnippetDialog used to sync state via an effect keyed
  // on `snippets`, so a fresh array identity every render caused infinite
  // re-render loops. That effect is gone; keeping the identity stable while
  // the inputs are unchanged still spares reference-sensitive consumers
  // (memo comparisons, effect deps) from reacting to a rebuilt array.
  const snippets = useMemo(
    () =>
      getGetPromptSnippets({
        promptHandle: promptHandle ?? undefined,
        apiKey,
        label,
      }),
    [promptHandle, apiKey, label],
  );

  const targets = useMemo(
    () => snippets.map((snippet) => snippet.target),
    [snippets],
  );

  if (!snippets) {
    return children;
  }

  const description = (
    <VStack alignItems="stretch" gap={3} marginBottom={4}>
      <Link
        href="https://docs.langwatch.ai/api-reference/prompts/get-prompt"
        isExternal
        color="blue.fg"
        _hover={{ textDecoration: "underline" }}
        fontSize="xs"
      >
        📖 View API documentation
      </Link>
      {mintKey.canMint && (
        <MintApiKeyBanner
          token={mintKey.token}
          onMint={mintKey.mint}
          isPending={mintKey.isPending}
          hint="to fill the snippet below."
        />
      )}
    </VStack>
  );

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={targets}
      title={label ? "Get Prompt by Tag" : "Get Prompt by ID"}
      description={description}
    >
      {children}
    </GenerateApiSnippetDialog>
  );
}

// Re-export the Trigger subcomponent for composability
GeneratePromptApiSnippetDialog.Trigger = GenerateApiSnippetDialog.Trigger;
