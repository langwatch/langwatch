import { PageLayout } from "@langwatch/design-system/page-layout";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../../behavior/ops-overlays.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { useUpgradeReadHints } from "../../behavior/use-upgrade-read-hints.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UPGRADE_STEP_OVERLAY, UpgradeStepDrawer } from "./upgrade-step-drawer.tsx";
import { UpgradesOverview } from "./upgrades-overview.tsx";

/** How many recent runs the overview lists. */
const RECENT_RUNS = 20;

/** W1: where the installation stands, its releases, failed steps and recent runs. */
export default function UpgradesScreen() {
  useUpgradeReadHints();
  const router = useOpsRouter();
  const stepDrawer = useOpsOverlay(UPGRADE_STEP_OVERLAY);
  const status = api.ops.upgrade.status.useQuery();
  const releases = api.ops.upgrade.listReleases.useQuery();
  const runs = api.ops.upgrade.listRuns.useQuery({ limit: RECENT_RUNS });
  const failed = api.ops.upgrade.listSteps.useQuery({ status: "failed" });

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Upgrades</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <UpgradeReadState read={status} failedTitle="The upgrade status could not load">
          {(current) => (
            <UpgradesOverview
              status={current}
              releases={releases.data?.items ?? []}
              runs={runs.data?.items ?? []}
              failedSteps={failed.data?.items ?? []}
              onOpenRelease={(release) =>
                router.push(`/ops/upgrades/releases/${encodeURIComponent(release)}`)
              }
              onOpenRun={(runId) => router.push(`/ops/upgrades/runs/${encodeURIComponent(runId)}`)}
              onOpenStep={stepDrawer.open}
            />
          )}
        </UpgradeReadState>
      </PageLayout.Container>
      {stepDrawer.value !== null && (
        <UpgradeStepDrawer stepId={stepDrawer.value} onClose={stepDrawer.close} />
      )}
    </>
  );
}
