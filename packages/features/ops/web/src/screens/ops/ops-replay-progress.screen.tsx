import { PageLayout } from "@langwatch/design-system/page-layout";
import { useOpsRouter } from "../../behavior/ops-router";
import { ReplayProgressContent } from "../../features/event-store/ui/sections/replay-progress-content";

export default function OpsReplayProgressScreen() {
  const router = useOpsRouter();
  const runId = router.query.runId ?? "";

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Replay Progress</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
        <ReplayProgressContent runId={runId} />
      </PageLayout.Container>
    </>
  );
}
