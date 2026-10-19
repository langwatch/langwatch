/**
 * The standalone run page at `/simulations/<set>/<batch>/<run>`: one run's
 * detail on a page of its own. Run Again stays here and shows the new run.
 * @see specs/features/suites/suite-bugfixes-1956.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { Box, Button, Skeleton, VStack } from "@langwatch/design-system/primitives";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { HandledErrorAlert } from "../../../behavior/errors.tsx";
import { useRunPageCallbacks } from "../../../behavior/use-run-page-callbacks.ts";
import { RunDetailDialogs, RunDetailView } from "./scenario-run-detail-view.tsx";
import { type ScenarioRunDetail, useScenarioRunDetail } from "./use-scenario-run-detail.ts";

export function ScenarioRunPage({
  setId,
  batchRunId,
  scenarioRunId,
}: {
  setId: string;
  batchRunId: string;
  scenarioRunId: string;
}) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const runCallbacks = useRunPageCallbacks();
  const detail = useScenarioRunDetail({ scenarioRunId, open: true, runCallbacks });

  const backToBatch = project?.slug ? (
    <Button
      size="xs"
      variant="ghost"
      onClick={() =>
        void router.push(
          `/${project.slug}/simulations/${encodeURIComponent(setId)}/${encodeURIComponent(batchRunId)}`,
        )
      }
    >
      <ArrowLeft size={14} /> Batch
    </Button>
  ) : null;

  return (
    <VStack width="full" height="full" gap={0} overflowY="auto" data-testid="scenario-run-page">
      <Box width="full" maxWidth="960px" marginX="auto" bg={"bg.card"}>
        <RunPageBody detail={detail} headerEnd={backToBatch} />
      </Box>
      <RunDetailDialogs detail={detail} />
    </VStack>
  );
}

function RunPageBody({ detail, headerEnd }: { detail: ScenarioRunDetail; headerEnd: ReactNode }) {
  const { scenarioState, runStateError } = detail;
  if (scenarioState) {
    return <RunDetailView detail={detail} scenarioState={scenarioState} headerEnd={headerEnd} />;
  }
  if (runStateError) {
    return (
      <Box padding={4}>
        <HandledErrorAlert error={runStateError} fallbackTitle="Failed to load run" />
      </Box>
    );
  }
  return (
    <VStack gap={4} align="start" width="full" padding={4}>
      <Skeleton height="32px" width="60%" />
      <Skeleton height="200px" width="full" borderRadius="md" />
    </VStack>
  );
}
