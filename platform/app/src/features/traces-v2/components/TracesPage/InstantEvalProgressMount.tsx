import type React from "react";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isInstantEvalRunActive } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { api } from "~/utils/api";
import { useInstantEvalRuns } from "../../hooks/useInstantEvalRuns";
import {
  selectInstantEvalRunPhase,
  useInstantEvalRunStore,
} from "../../stores/instantEvalRunStore";
import { InstantEvalProgressBar } from "./InstantEvalProgressBar";

/**
 * The progress bar for the run behind the query that has not settled, if any.
 * Reads the run store the page's watch keeps current, and asks the run to
 * cancel on Stop. The bar stays, saying it is stopping, until the run's
 * numbers hold still; the chip stays and reads as partial from then on.
 */
export const InstantEvalProgressMount: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const { chips } = useInstantEvalRuns();
  const runState = useInstantEvalRunStore();
  const { runs, markStopped } = runState;
  const cancel = api.tracesV2.instantEval.cancel.useMutation();

  const candidates = chips.map((chip) => ({
    chip,
    run: chip.runId ? runs[chip.runId] : undefined,
    phase: chip.runId ? selectInstantEvalRunPhase(runState, chip.runId) : null,
  }));
  const active =
    candidates.find(({ phase }) => phase === "interrupted") ??
    candidates.find(({ phase }) => phase === "unavailable") ??
    candidates.find(({ phase }) => phase !== null && phase !== "settled");

  // The answer to a cancel is the run as it was when asked, so it is not
  // written to the store: the poll reads what the run does next.
  const onStop = useCallback(() => {
    if (!active?.run || !project?.id) return;
    const runId = active.run.id;
    markStopped(runId);
    cancel.mutate({ projectId: project.id, runId });
  }, [active, cancel, markStopped, project?.id]);

  if (!active?.phase || active.phase === "settled") return null;
  return (
    <InstantEvalProgressBar
      judged={active.run?.progress ?? 0}
      total={active.run?.total ?? null}
      matched={active.run?.matched ?? 0}
      question={active.chip.question}
      phase={active.phase}
      runId={active.chip.runId ?? undefined}
      hasReportedCounts={Boolean(active.run)}
      isReadUnavailable={Boolean(
        active.chip.runId && runState.readUnavailable[active.chip.runId],
      )}
      canStop={Boolean(
        active.run &&
          isInstantEvalRunActive(active.run.status) &&
          !runState.stoppedByUser[active.run.id],
      )}
      onStop={onStop}
    />
  );
};
