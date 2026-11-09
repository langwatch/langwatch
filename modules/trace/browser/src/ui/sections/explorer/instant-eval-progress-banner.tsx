/**
 * The progress bar over the table, for the run the newest eval chip names. It
 * reads the store the watch fills, Stop cancels the run, and a failed run
 * shows why with Retry instead.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { useCancelInstantEval } from "../../../behavior/writes/use-trace-writes.ts";
import {
  selectInstantEvalRunPhase,
  useInstantEvalRunStore,
} from "../../../features/instant-eval/behavior/instant-eval-run.store.ts";
import { useInstantEvalRuns } from "../../../features/instant-eval/behavior/use-instant-eval-runs.ts";
import { useRetryInstantEval } from "../../../features/instant-eval/behavior/use-retry-instant-eval.ts";
import { instantEvalFailureMessage } from "../../../model/instant-eval-failure.ts";
import { InstantEvalFailureBar } from "../../elements/explorer/instant-eval-failure.tsx";
import { InstantEvalProgressBar } from "../../elements/explorer/instant-eval-progress.tsx";

export function InstantEvalProgressBanner() {
  const { project } = useOrganizationTeamProject();
  const { chips } = useInstantEvalRuns();
  const runs = useInstantEvalRunStore((s) => s.runs);
  const stoppedByUser = useInstantEvalRunStore((s) => s.stoppedByUser);
  const settled = useInstantEvalRunStore((s) => s.settled);
  const markStopped = useInstantEvalRunStore((s) => s.markStopped);
  const cancel = useCancelInstantEval();

  // The last chip whose run still has something to show: a settled run has no bar,
  // and a failed run never settles, so it stays reachable behind a later settled one.
  const chip = [...chips].reverse().find((entry) => {
    if (!entry.runId) return false;
    const entryPhase = selectInstantEvalRunPhase({ runs, stoppedByUser, settled }, entry.runId);
    return entryPhase !== null && entryPhase !== "settled";
  });
  const runId = chip?.runId ?? null;
  const phase = runId ? selectInstantEvalRunPhase({ runs, stoppedByUser, settled }, runId) : null;

  const retry = useRetryInstantEval();
  const onStop = () => {
    if (!runId || !project?.id) return;
    markStopped(runId);
    cancel.mutate({ projectId: project.id, runId });
  };

  if (!chip || !runId || phase === null || phase === "settled") return null;
  const run = runs[runId];
  if (!run) return null;
  if (phase === "failed") {
    return (
      <InstantEvalFailureBar
        message={instantEvalFailureMessage({ run })}
        onRetry={() => retry(chip.key)}
      />
    );
  }

  return (
    <InstantEvalProgressBar
      judged={run.progress}
      total={run.total}
      matched={run.matched ?? 0}
      question={chip.question}
      phase={phase}
      onStop={onStop}
    />
  );
}
