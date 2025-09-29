import { Tooltip } from "../../../../components/ui/tooltip";
import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";

export function VersionHistoryButton({
  configId,
  onRestoreSuccess,
  label,
}: {
  configId: string;
  onRestoreSuccess?: (params: { versionId: string; configId: string }) => Promise<void>;
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
