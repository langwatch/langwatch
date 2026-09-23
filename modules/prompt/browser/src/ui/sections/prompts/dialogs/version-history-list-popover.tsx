import { useDisclosure } from "@chakra-ui/react";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { createLogger } from "@langwatch/observability/browser";
import { useCallback, useEffect } from "react";

import { usePromptVersionHistory } from "../../../../behavior/prompts/use-prompt-version-history.ts";
import type { WireVersionedPrompt } from "../../../../model/wire-versioned-prompt.ts";
import { VersionHistoryPopover } from "../../../elements/prompts/version-history-list-popover.tsx";

const logger = createLogger("VersionHistoryListPopover");

/**
 * Fully composed popover: fetches via `behavior/prompts/`, renders the pure
 * `VersionHistoryPopover` (Record 10).
 */
export function VersionHistoryListPopover({
  configId,
  currentVersionId,
  onRestoreSuccess,
  hasUnsavedChanges,
  label,
  initialOpen,
}: {
  configId: string;
  /** The versionId of the version currently being edited. If not provided, defaults to latest. */
  currentVersionId?: string;
  onRestoreSuccess?: (prompt: WireVersionedPrompt) => Promise<void>;
  hasUnsavedChanges?: boolean;
  label?: string;
  /** When true the popover opens automatically on first render. */
  initialOpen?: boolean;
}) {
  const { open, setOpen, onClose } = useDisclosure();

  useEffect(() => {
    if (initialOpen) {
      setOpen(true);
    }
    // Only run on mount — intentionally omitting setOpen and initialOpen from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { project } = useOrganizationTeamProject();
  const { versions: prompts, isLoading } = usePromptVersionHistory({
    configId,
    projectId: project?.id,
    isOpen: open,
  });

  /**
   * Load version data into the form without creating a new version.
   * User will need to save manually to complete the restore.
   */
  const handleRestore = useCallback(
    (params: { versionId: string }) => {
      void (async () => {
        const { versionId } = params;

        // Find the version in the already-fetched data
        const prompt = prompts.find((p) => p.versionId === versionId);
        if (!prompt) {
          logger.error("Version not found in loaded data");
          toaster.error({
            title: "Failed to load version",
            description: "Version not found",
          });
          return;
        }

        try {
          await onRestoreSuccess?.(prompt);
          onClose();
          toaster.info({
            title: `Restored prompt to version ${prompt.version}`,
          });
        } catch (error) {
          logger.error({ error }, "Error loading version");
          showErrorToast({
            error,
            fallbackTitle: "Couldn't load this version",
          });
        }
      })();
    },
    [prompts, onRestoreSuccess, onClose],
  );

  return (
    <VersionHistoryPopover
      isOpen={open}
      onOpenChange={(open) => {
        setOpen(open);
      }}
      onRestore={handleRestore}
      versions={prompts}
      isLoading={isLoading}
      hasUnsavedChanges={hasUnsavedChanges}
      currentVersionId={currentVersionId}
      label={label}
    />
  );
}
