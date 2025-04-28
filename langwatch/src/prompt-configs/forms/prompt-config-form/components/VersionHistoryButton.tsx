import { Button } from "@chakra-ui/react";

import { VersionHistoryListPopover } from "../../../VersionHistoryListPopover";

export function VersionHistoryButton({ configId }: { configId: string }) {
  return (
    <Button variant="outline" marginLeft={2}>
      <VersionHistoryListPopover configId={configId} />
    </Button>
  );
}
