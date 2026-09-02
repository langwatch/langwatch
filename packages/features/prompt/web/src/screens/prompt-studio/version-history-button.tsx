import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { VersionHistoryListPopover } from "./dialogs/version-history-list-popover";

export function VersionHistoryButton({
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
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
  hasUnsavedChanges?: boolean;
  label?: string;
  /** When true the history panel opens automatically on mount. */
  initialOpen?: boolean;
}) {
  return (
    <Tooltip
      content="View previous versions"
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <VersionHistoryListPopover
        configId={configId}
        currentVersionId={currentVersionId}
        onRestoreSuccess={onRestoreSuccess}
        hasUnsavedChanges={hasUnsavedChanges}
        label={label}
        initialOpen={initialOpen}
      />
    </Tooltip>
  );
}
