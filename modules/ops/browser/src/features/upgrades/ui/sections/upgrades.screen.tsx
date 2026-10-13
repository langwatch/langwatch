import { PageLayout } from "@langwatch/design-system/page-layout";
import { VStack } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../../behavior/ops-overlays.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { useIsSharedInstall } from "../../../../behavior/ops-session.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { useRetryUpgradeStep } from "../../behavior/use-retry-upgrade-step.ts";
import { useUpgradeReadHints } from "../../behavior/use-upgrade-read-hints.ts";
import { heldOrganizationCount, isFinished } from "../../model/upgrade-labels.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeReleaseStepsRead } from "./upgrade-release-steps.tsx";
import { UPGRADE_RUN_OVERLAY, UpgradeRunDrawer } from "./upgrade-run-drawer.tsx";
import { UpgradeRuns } from "./upgrade-runs.tsx";
import { UPGRADE_STEP_OVERLAY, UpgradeStepDrawer } from "./upgrade-step-drawer.tsx";
import { UpgradeStepsTab } from "./upgrade-steps-tab.tsx";
import { UpgradeTenantMigrations } from "./upgrade-tenant-migrations.tsx";
import { UpgradesOverview } from "./upgrades-overview.tsx";
import {
  parseUpgradesTab,
  privateTargetsOf,
  UPGRADES_TAB_PARAM,
  type UpgradesTab,
  UpgradesTabs,
} from "./upgrades-tabs.tsx";

/** How many recent runs the Runs tab lists. */
const RECENT_RUNS = 20;

/** Ops, Upgrades (ADR-173 section 7): Overview, Runs, Steps, Organizations and Dataplanes. */
export default function UpgradesScreen() {
  useUpgradeReadHints();
  const router = useOpsRouter();
  const stepDrawer = useOpsOverlay(UPGRADE_STEP_OVERLAY);
  const runDrawer = useOpsOverlay(UPGRADE_RUN_OVERLAY);
  const status = api.ops.upgrade.status.useQuery();
  const releases = api.ops.upgrade.listReleases.useQuery();
  const runs = api.ops.upgrade.listRuns.useQuery({ limit: RECENT_RUNS });
  const background = api.ops.upgrade.listSteps.useQuery({ mode: "background" });
  const operator = api.ops.upgrade.listSteps.useQuery({ mode: "operator" });
  const targets = api.ops.upgrade.listTargets.useQuery();
  const migrations = api.ops.upgrade.listSystemMigrations.useQuery();
  const sharedInstall = useIsSharedInstall();
  const canManage = useOpsHost().isOpsAdmin();
  const { retryStep, retryingStepId } = useRetryUpgradeStep();
  const onRetryStep = canManage ? retryStep : void 0;
  const tab = parseUpgradesTab({
    value: router.query[UPGRADES_TAB_PARAM],
    hasTargets: privateTargetsOf(targets.data ?? []).length > 0,
  });
  const selectTab = (next: UpgradesTab) =>
    router.replace({
      query: { ...router.query, [UPGRADES_TAB_PARAM]: next === "overview" ? void 0 : next },
    });

  return (
    <>
      <PageLayout.Header flexWrap="wrap">
        <VStack align="start" gap={1} minWidth={0}>
          <PageLayout.Heading>Upgrades</PageLayout.Heading>
          <PageLayout.Subtitle>
            The running version, its upgrade runs and steps, and organization progress.
          </PageLayout.Subtitle>
        </VStack>
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full">
        <UpgradeReadState read={status} failedTitle="The upgrade status could not load">
          {(current) => (
            <UpgradesTabs
              targets={targets.data ?? []}
              tab={tab}
              onSelectTab={selectTab}
              overview={
                <UpgradesOverview
                  status={current}
                  hasRuns={(runs.data?.items ?? []).length > 0}
                  operatorSteps={(operator.data?.items ?? []).filter(
                    (step) => !isFinished(step.status),
                  )}
                  onRetryStep={onRetryStep}
                  retryingStepId={retryingStepId}
                  onOpenStep={stepDrawer.open}
                  heldOrganizations={heldOrganizationCount(migrations.data ?? [])}
                  sharedInstall={sharedInstall}
                  onOpenOrganizations={() => selectTab("organizations")}
                />
              }
              runs={<UpgradeRuns runs={runs.data?.items ?? []} onOpenRun={runDrawer.open} />}
              steps={
                <UpgradeStepsTab
                  releases={releases.data?.items ?? []}
                  backgroundSteps={(background.data?.items ?? []).filter(
                    (step) => !isFinished(step.status),
                  )}
                  backgroundLoading={background.isLoading}
                  onOpenStep={stepDrawer.open}
                  onRetryStep={onRetryStep}
                  retryingStepId={retryingStepId}
                  releaseSteps={(release) => (
                    <UpgradeReleaseStepsRead release={release} onOpenStep={stepDrawer.open} />
                  )}
                />
              }
              organizations={<UpgradeTenantMigrations />}
            />
          )}
        </UpgradeReadState>
      </PageLayout.Container>
      {runDrawer.value !== null && (
        <UpgradeRunDrawer runId={runDrawer.value} onClose={runDrawer.close} />
      )}
      {stepDrawer.value !== null && (
        <UpgradeStepDrawer stepId={stepDrawer.value} onClose={stepDrawer.close} />
      )}
    </>
  );
}
