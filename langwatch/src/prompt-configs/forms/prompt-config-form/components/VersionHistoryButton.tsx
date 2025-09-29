import type { VersionedPrompt } from "~/server/prompt-config";
import { Tooltip } from "../../../../components/ui/tooltip";
import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";

export function VersionHistoryButton({
  configId,
  onRestoreSuccess,
  label,
}: {
  configId: string;
  onRestoreSuccess?: (prompt: VersionedPrompt) => Promise<void>;
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
        label={label}
      />
    </Tooltip>
  );
}
