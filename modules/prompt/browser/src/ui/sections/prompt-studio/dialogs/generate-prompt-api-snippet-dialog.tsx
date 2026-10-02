import { useMintPersonalToken } from "@langwatch/api-key-client";
import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { Link } from "@langwatch/browser-host/link";
import {
  API_KEY_PLACEHOLDER,
  PersonalAccessTokenBanner,
} from "@langwatch/design-system/personal-access-token-banner";
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

  const controls =
    organizationId && project ? (
      <PersonalAccessTokenBanner
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
