/**
 * One run plan: its runs in a rail on the left, the results of the selected
 * run filling the rest of the page.
 *
 * The results read as a table by default. The grid is the classic wall of
 * live conversation cards, the same component the v1 page draws.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { HStack } from "@chakra-ui/react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { RunPlanResultsColumn } from "./RunPlanResultsColumn";
import { RunsSidebar } from "./RunsSidebar";
import type { RunPlan } from "./run-plans";
import { useRunPlanBatches, useSelectedBatch } from "./useRunPlanBatches";

export type RunPlanDetailProps = {
  plan: RunPlan;
  batchRunId: string | null;
  onSelectRun: (batchRunId: string) => void;
  onBack: () => void;
  onEditPlan: (suiteId: string) => void;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
  /** While the live stream is up the fallback polling stands down. */
  isSseConnected: boolean;
};

export function RunPlanDetail(props: RunPlanDetailProps) {
  const { plan } = props;
  const pendingRun = useAgentTestingStore((state) => state.pendingRun);
  const pendingBatchRunId =
    pendingRun?.scenarioSetId === plan.scenarioSetId
      ? pendingRun.batchRunId
      : null;

  const batches = useRunPlanBatches({
    plan,
    period: props.period,
    isSseConnected: props.isSseConnected,
  });

  const selection = useSelectedBatch({
    batches,
    batchRunId: props.batchRunId,
  });

  return (
    <HStack
      align="stretch"
      gap={0}
      width="full"
      height="full"
      data-testid="agent-testing-run-plan-detail"
    >
      <RunsSidebar
        runs={batches}
        selectedBatchRunId={selection.selectedBatch?.batchRunId ?? null}
        pendingBatchRunId={pendingBatchRunId}
        onSelectRun={props.onSelectRun}
        onBack={props.onBack}
        periodControls={props}
      />

      <RunPlanResultsColumn
        plan={plan}
        batches={batches}
        selection={selection}
        periodControls={props}
        onEditPlan={props.onEditPlan}
      />
    </HStack>
  );
}
