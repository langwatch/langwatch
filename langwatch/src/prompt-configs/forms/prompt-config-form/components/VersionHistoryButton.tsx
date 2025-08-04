import { Button } from "@chakra-ui/react";

import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";
import { Tooltip } from "../../../../components/ui/tooltip";

export function VersionHistoryButton({
  configId,
  onRestore,
  label,
}: {
  configId: string;
  onRestore?: (versionId: string) => void;
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
        onRestore={onRestore}
        label={label}
      />
    </Tooltip>
  );
}
