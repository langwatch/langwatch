import { Button } from "@chakra-ui/react";

import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";
import { Tooltip } from "../../../../components/ui/tooltip";

export function VersionHistoryButton({
  configId,
  onRestore,
}: {
  configId: string;
  onRestore?: (versionId: string) => void;
}) {
  return (
    <Tooltip
      content="View previous versions"
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      <Button variant="outline">
        <VersionHistoryListPopover configId={configId} onRestore={onRestore} />
      </Button>
    </Tooltip>
  );
}
