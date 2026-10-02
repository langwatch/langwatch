import { useMintPersonalToken } from "@langwatch/api-key-client";
import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { Link } from "@langwatch/browser-host/link";
import { CopyButton } from "@langwatch/design-system/copy-button";
import { API_KEY_PLACEHOLDER } from "@langwatch/design-system/personal-access-token-banner";
import { Alert, Button, HStack, Text } from "@langwatch/design-system/primitives";
import { KeyRound } from "lucide-react";
import type React from "react";
import { useMemo } from "react";

import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";
import {
  getGetPromptSnippets,
  type PromptSnippetVariable,
} from "../../api-snippet/get-prompt-snippets.ts";
import { GenerateApiSnippetDialog } from "./generate-api-snippet-dialog.tsx";

interface GeneratePromptApiSnippetButtonProps {
  promptHandle?: string | null;
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
  label,
  variables,
  children,
  open,
  onOpenChange,
}: GeneratePromptApiSnippetButtonProps) {
  const { project, organizationId } = usePromptProject();
  const host = usePromptHost();
  const minting = useMintPersonalToken({
    organizationId,
    projectId: project?.id,
    userId: useOptionalUiCapabilities()?.session.currentUser()?.id,
    name: "Personal access token",
    permissions: ["prompts:view"],
  });
  const token = minting.token ?? null;
  // Keyed on the serialized variables rather than the array itself: callers
  // hand over a fresh array identity every render, which would defeat the
  // memo entirely.
  const variablesKey = JSON.stringify(variables ?? []);
  const snippets = useMemo(
    () =>
      getGetPromptSnippets({
        promptHandle: promptHandle ?? undefined,
        apiKey: token ?? API_KEY_PLACEHOLDER,
        label,
        variables: JSON.parse(variablesKey) as PromptSnippetVariable[],
      }),
    [promptHandle, token, label, variablesKey],
  );

  const targets = useMemo(() => snippets.map((snippet) => snippet.target), [snippets]);

  if (!snippets) {
    return children;
  }

  const description = (
    <>
      Fetch this prompt from your code, filled with its variables.{" "}
      <Link
        href="https://docs.langwatch.ai/api-reference/prompts/get-prompt"
        isExternal
        color="fg.info"
        _hover={{ textDecoration: "underline" }}
      >
        API reference
      </Link>
    </>
  );

  const controls =
    organizationId && project ? (
      <TokenCallout
        token={token}
        isCreating={minting.isMinting}
        scopeNote={minting.scopeNote}
        onCreate={() =>
          void minting
            .mint()
            .catch((error: unknown) =>
              host.failed({ error, fallbackTitle: "Couldn't create the personal access token" }),
            )
        }
      />
    ) : null;

  return (
    <GenerateApiSnippetDialog
      snippets={snippets}
      targets={targets}
      title="Get and use this prompt"
      description={description}
      controls={controls}
      sensitiveValue={token ?? undefined}
      copyDisabled={!token}
      open={open}
      onOpenChange={onOpenChange}
    >
      {children}
    </GenerateApiSnippetDialog>
  );
}

// Re-export the Trigger subcomponent for composability
GeneratePromptApiSnippetDialog.Trigger = GenerateApiSnippetDialog.Trigger;

/** A quiet info callout: mint a personal access token to fill the snippet, then copy it once. */
function TokenCallout({
  token,
  isCreating,
  scopeNote,
  onCreate,
}: {
  token: string | null;
  isCreating: boolean;
  scopeNote?: string;
  onCreate: () => void;
}) {
  return (
    <Alert.Root status="info" variant="subtle" size="sm" borderRadius="md" alignItems="center">
      <Alert.Indicator>
        <KeyRound size={14} />
      </Alert.Indicator>
      <Alert.Content gap={0.5}>
        <Alert.Description fontSize="sm">
          {token ? (
            <HStack gap={1} as="span">
              <Text as="span" fontWeight="medium">
                Copy this token now; it won&apos;t be shown again.
              </Text>
              <CopyButton
                value={token}
                label="Personal access token"
                aria-label="Copy personal access token"
              />
            </HStack>
          ) : (
            "Create a personal access token to fill in the snippet."
          )}
        </Alert.Description>
        {scopeNote ? (
          <Text fontSize="xs" color="fg.muted">
            {scopeNote}
          </Text>
        ) : null}
      </Alert.Content>
      <Button
        size="xs"
        variant={token ? "ghost" : "outline"}
        loading={isCreating}
        onClick={onCreate}
        aria-label={token ? "Create another" : "Create a personal access token"}
      >
        {token ? "Create another" : "Create token"}
      </Button>
    </Alert.Root>
  );
}
