import { PageLayout } from "@langwatch/design-system/page-layout";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../../behavior/ops-overlays.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { useRetryUpgradeStep } from "../../behavior/use-retry-upgrade-step.ts";
import { useUpgradeReadHints } from "../../behavior/use-upgrade-read-hints.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UPGRADE_STEP_OVERLAY, UpgradeStepDrawer } from "./upgrade-step-drawer.tsx";
import { UpgradesOverview } from "./upgrades-overview.tsx";

/** Background step statuses that are finished; every other one is still listed. */
const FINISHED = new Set(["done", "not-needed"]);

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
  const background = api.ops.upgrade.listSteps.useQuery({ mode: "background" });
  const canManage = useOpsHost().isOpsAdmin();
  const { retryStep, retryingStepId } = useRetryUpgradeStep();

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
              backgroundSteps={(background.data?.items ?? []).filter(
                (step) => !FINISHED.has(step.status),
              )}
              backgroundLoading={background.isLoading}
              onRetryStep={canManage ? retryStep : void 0}
              retryingStepId={retryingStepId}
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
