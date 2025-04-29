import { Button } from "@chakra-ui/react";

import { VersionHistoryListPopover } from "../../../components/VersionHistoryListPopover";

export function VersionHistoryButton({
  configId,
  onRestore,
}: {
  configId: string;
  onRestore?: (versionId: string) => void;
}) {
  return (
    <Button variant="outline" marginLeft={2}>
      <VersionHistoryListPopover configId={configId} onRestore={onRestore} />
    </Button>
  );
}
