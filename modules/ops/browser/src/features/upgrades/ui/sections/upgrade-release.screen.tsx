import { PageLayout } from "@langwatch/design-system/page-layout";
import { VStack } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsOverlay } from "../../../../behavior/ops-overlays.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { useUpgradeReadHints } from "../../behavior/use-upgrade-read-hints.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeReleaseSteps } from "./upgrade-release-steps.tsx";
import { UPGRADE_STEP_OVERLAY, UpgradeStepDrawer } from "./upgrade-step-drawer.tsx";
import { UNRELEASED } from "./upgrades-overview.tsx";

/** W2: one release's steps, grouped by mode; a step opens the drawer. */
export default function UpgradeReleaseScreen() {
  useUpgradeReadHints();
  const router = useOpsRouter();
  const stepDrawer = useOpsOverlay(UPGRADE_STEP_OVERLAY);
  const segment = router.query.release ?? UNRELEASED;
  const release = segment === UNRELEASED ? null : segment;
  const steps = api.ops.upgrade.listSteps.useQuery({ release });

  return (
    <>
      <PageLayout.Header
        flexWrap="wrap"
        actions={
          <PageLayout.HeaderButton onClick={() => router.push("/ops/upgrades")}>
            Back to upgrades
          </PageLayout.HeaderButton>
        }
      >
        <VStack gap={1} align="start" minWidth={0}>
          <PageLayout.Heading>
            {release ? `Release ${release}` : "Unreleased steps"}
          </PageLayout.Heading>
          <PageLayout.Subtitle>
            Track outstanding steps and inspect their execution details.
          </PageLayout.Subtitle>
        </VStack>
      </PageLayout.Header>
      <PageLayout.Container maxWidth="full">
        <UpgradeReadState read={steps} failedTitle="The release's steps could not load">
          {(page) => (
            <UpgradeReleaseSteps
              release={release}
              steps={page.items}
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
