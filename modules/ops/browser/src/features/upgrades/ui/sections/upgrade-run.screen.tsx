import { PageLayout } from "@langwatch/design-system/page-layout";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { useUpgradeReadHints } from "../../behavior/use-upgrade-read-hints.ts";
import { UpgradeReadState } from "./upgrade-read-state.tsx";
import { UpgradeRunPhases } from "./upgrade-run-phases.tsx";

/** W4: one run's phases and steps; the runner's hint re-reads it while it runs. */
export default function UpgradeRunScreen() {
  useUpgradeReadHints();
  const router = useOpsRouter();
  const runId = router.query.runId ?? "";
  const run = api.ops.upgrade.getRun.useQuery({ id: runId }, { enabled: runId !== "" });

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Upgrade run</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <UpgradeReadState read={run} failedTitle="The upgrade run could not load">
          {(detail) => <UpgradeRunPhases run={detail} />}
        </UpgradeReadState>
      </PageLayout.Container>
    </>
  );
}
