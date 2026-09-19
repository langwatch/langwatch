import type React from "react";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isInstantEvalRunActive } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { api } from "~/utils/api";
import { useInstantEvalRuns } from "../../hooks/useInstantEvalRuns";
import { useInstantEvalRunStore } from "../../stores/instantEvalRunStore";
import { InstantEvalProgressBar } from "./InstantEvalProgressBar";

/**
 * The progress bar for the run still judging behind the query, if any. Reads
 * the run store the page's watch keeps current, and asks the run to cancel
 * on Stop; the chip stays and reads as partial from then on.
 */
export const InstantEvalProgressMount: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const { chips } = useInstantEvalRuns();
  const runs = useInstantEvalRunStore((s) => s.runs);
  const markStopped = useInstantEvalRunStore((s) => s.markStopped);
  const cancel = api.tracesV2.instantEval.cancel.useMutation();
  const setRun = useInstantEvalRunStore((s) => s.setRun);

  const active = chips
    .map((chip) => ({ chip, run: chip.runId ? runs[chip.runId] : undefined }))
    .find(({ run }) => run && isInstantEvalRunActive(run.status));

  const onStop = useCallback(() => {
    if (!active?.run || !project?.id) return;
    const runId = active.run.id;
    markStopped(runId);
    cancel.mutate(
      { projectId: project.id, runId },
      { onSuccess: (row) => setRun(row) },
    );
  }, [active, cancel, markStopped, project?.id, setRun]);

  if (!active?.run) return null;
  return (
    <InstantEvalProgressBar
      judged={active.run.progress}
      total={active.run.total}
      matched={active.run.matched ?? 0}
      question={active.chip.question}
      isStopping={cancel.isPending}
      onStop={onStop}
    />
  );
};
