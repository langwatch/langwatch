import type { VersionedPrompt } from "~/server/prompt-config";
import { Tooltip } from "../../../../components/ui/tooltip";
import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";

export function VersionHistoryButton({
  configId,
  onRestoreSuccess,
  onDiscardChanges,
  hasUnsavedChanges,
  label,
}: {
  configId: string;
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
  onDiscardChanges?: () => void;
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
        onRestoreSuccess={onRestoreSuccess}
        onDiscardChanges={onDiscardChanges}
        hasUnsavedChanges={hasUnsavedChanges}
        label={label}
      />
    </Tooltip>
  );
}
