import type { VersionedPrompt } from "~/server/prompt-config";
import { Tooltip } from "../../../../components/ui/tooltip";
import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";

export function VersionHistoryButton({
  configId,
  currentVersionId,
  onRestoreSuccess,
  hasUnsavedChanges,
  label,
}: {
  configId: string;
  /** The versionId of the version currently being edited. If not provided, defaults to latest. */
  currentVersionId?: string;
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
  hasUnsavedChanges?: boolean;
  label?: string;
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
      />
    </Tooltip>
  );
}
