import { Button } from "@langwatch/design-system/primitives";

import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";
import { useReapStrandedGroups } from "../../behavior/use-reap-stranded-groups.ts";

/** The operator's hand-run of the scheduled reaper, for when stuck groups cannot wait an hour. */
export function ReapStrandedGroupsAction() {
  const reap = useReapStrandedGroups();
  return (
    <>
      <Button variant="outline" size="2xs" colorPalette="orange" onClick={reap.open}>
        Clear stuck groups
      </Button>
      <ConfirmDialog
        open={reap.confirming}
        onClose={reap.close}
        onConfirm={reap.confirm}
        title="Clear stuck groups"
        description="Deletes queue groups no worker will ever pick up, stranded for six hours or more, and recounts pending jobs. Their jobs are lost."
        isLoading={reap.isLoading}
      />
    </>
  );
}
