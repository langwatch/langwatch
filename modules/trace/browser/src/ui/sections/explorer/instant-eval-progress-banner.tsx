/**
 * The progress bar over the table, for the run the newest eval chip names. It
 * reads the store the watch fills, and Stop cancels the run.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { useCallback } from "react";

import {
  selectInstantEvalRunPhase,
  useInstantEvalRunStore,
} from "../../../behavior/instant-eval-run.store.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { InstantEvalProgressBar } from "../../elements/explorer/instant-eval-progress.tsx";
import { useInstantEvalRuns } from "./hooks/use-instant-eval-runs.ts";

export function InstantEvalProgressBanner() {
  const { project } = useOrganizationTeamProject();
  const { chips } = useInstantEvalRuns();
  const runs = useInstantEvalRunStore((s) => s.runs);
  const stoppedByUser = useInstantEvalRunStore((s) => s.stoppedByUser);
  const settled = useInstantEvalRunStore((s) => s.settled);
  const markStopped = useInstantEvalRunStore((s) => s.markStopped);
  const cancel = api.traces.instantEvalCancel.useMutation();

  // The last chip typed is the one being judged; an earlier chip's run has
  // already settled, and a settled run has no bar.
  const chip = [...chips].reverse().find((entry) => {
    if (!entry.runId) return false;
    return selectInstantEvalRunPhase({ runs, stoppedByUser, settled }, entry.runId) !== null;
  });
  const runId = chip?.runId ?? null;
  const phase = runId ? selectInstantEvalRunPhase({ runs, stoppedByUser, settled }, runId) : null;

  const onStop = useCallback(() => {
    if (!runId || !project?.id) return;
    markStopped(runId);
    cancel.mutate({ projectId: project.id, runId });
  }, [cancel, markStopped, project?.id, runId]);

  if (!chip || !runId || phase === null || phase === "settled") return null;
  const run = runs[runId];
  if (!run) return null;

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
