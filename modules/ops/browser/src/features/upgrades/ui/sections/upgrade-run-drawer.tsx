import { Drawer } from "@langwatch/design-system/drawer";

import { api } from "../../../../behavior/ops-api.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeRunDetail } from "./upgrade-run-phases.tsx";

/** The address key the run drawer opens under (`?upgradeRun=<id>`). */
export const UPGRADE_RUN_OVERLAY = "upgradeRun";

/** W4: one run over the Runs tab; the screen's read hints re-read it while it runs. */
export function UpgradeRunDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const run = api.ops.upgrade.getRun.useQuery({ id: runId });
  return (
    <Drawer title={runId} eyebrow={{ label: "Upgrade run" }} size="lg" onClose={onClose}>
      <UpgradeReadState read={run} failedTitle="The upgrade run could not load">
        {(detail) => <UpgradeRunDetail run={detail} />}
      </UpgradeReadState>
    </Drawer>
  );
}
