import { promptClient } from "@langwatch/prompt-client";

/**
 * The version list a version-history popover renders. Moved out of the
 * `ui/elements` popover (Record 10: elements cannot fetch) - the query and
 * its `enabled` gate are unchanged, only their location.
 */
export function usePromptVersionHistory({
  configId,
  projectId,
  isOpen,
}: {
  configId: string;
  projectId: string | undefined;
  isOpen: boolean;
}) {
  const { data: versions = [], isLoading } = promptClient.prompts.getAllVersionsForPrompt.useQuery(
    {
      idOrHandle: configId,
      projectId: projectId ?? "",
    },
    {
      enabled: isOpen && !!projectId && !!configId,
    },
  );

  return { versions, isLoading };
}
