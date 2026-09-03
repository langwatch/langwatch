import { useCallback, useState } from "react";
import { showErrorToast } from "../../behavior/errors";
import type { ScenarioFailureAction } from "../../model/scenario-host";
import type { RunParameterValues } from "@langwatch/scenario-contract";
import type { TargetValue } from "./scenarios/target-selector";
import { toaster } from "@langwatch/design-system/toaster";
import { api } from "../../behavior/scenario-api";
import { type PollResult, pollForScenarioRun } from "../../model/poll-for-scenario-run";
import { useModelProvidersSettings } from "@langwatch/model-provider-web/hooks/useModelProvidersSettings";

interface RunCompleteResult {
  scenarioRunId: string;
  setId: string;
  batchRunId: string;
}

interface UseRunScenarioOptions {
  projectId: string | undefined;
  projectSlug: string | undefined;
  /**
   * Called as soon as the run is queued, before its first event lands. The
   * run has no scenarioRunId yet; the batch is what there is to watch.
   */
  onQueued?: (result: { setId: string; batchRunId: string }) => void;
  /** Called when the run completes successfully. Navigate to the result here. */
  onRunComplete?: (result: RunCompleteResult) => void;
  /** Called when the run fails. Use this to show the failed run (e.g., open a drawer). */
  onRunFailed?: (result: RunCompleteResult) => void;
}

interface RunScenarioParams {
  scenarioId: string;
  target: TargetValue;
  setId?: string;
  batchRunId?: string;
  /** One short line describing why this run was started. */
  note?: string;
  /** Values that override the scenario's own parameter defaults for this run. */
  parameters?: RunParameterValues;
}

/**
 * Builds the way out that opens a finished run.
 *
 * Returns undefined when there is no run to open, and when the caller supplied
 * no `onRunFailed` handler — a button that does nothing when clicked is worse
 * than no button. `ScenarioFormDrawer` is such a caller.
 *
 * `run` rather than `onClick`, which is the shape `ScenarioFailureNotice.action`
 * takes: two of the three outcomes below are failures and report through the
 * host, and only the third — a run that finished and did not pass — is a toast
 * this file raises itself.
 */
function buildViewRunAction({
  label,
  scenarioRunId,
  setId,
  batchRunId,
  onRunFailed,
}: {
  label: string;
  scenarioRunId: string | undefined;
  setId: string;
  batchRunId: string;
  onRunFailed: ((result: RunCompleteResult) => void) | undefined;
}): ScenarioFailureAction | undefined {
  if (!scenarioRunId || !onRunFailed) return undefined;

  return {
    label,
    run: () => onRunFailed({ scenarioRunId, setId, batchRunId }),
  };
}

/**
 * Reports a poll result that is not a success.
 *
 * The three cases are genuinely different events, and saying so is the point of
 * this module: a run that did not pass produced an outcome, a run that errored
 * produced nothing, and a timeout means nothing became visible at all. Lives
 * outside the hook so the run callback stays about running the scenario.
 *
 * ONE OUTCOME, TWO CHANNELS, and the split is the distinction above rather than
 * a compromise. A run that finished and did not pass is a RESULT: no error
 * framing, and the feedback port has nothing to say it with — `succeeded` and
 * `failed` are its two channels and neither means "it finished, and the answer
 * was no". So that one stays a `warning` notice raised here. The other two are
 * failures, and go through the host, where they pick up the application's copy
 * rules, its duration and its trace id.
 */
function reportRunOutcome({
  result,
  setId,
  batchRunId,
  onRunFailed,
}: {
  result: Extract<PollResult, { success: false }>;
  setId: string;
  batchRunId: string;
  onRunFailed: ((result: RunCompleteResult) => void) | undefined;
}): void {
  const viewRunAction = (label: string) =>
    buildViewRunAction({
      label,
      scenarioRunId: result.scenarioRunId,
      setId,
      batchRunId,
      onRunFailed,
    });

  if (result.error === "run_failed") {
    // The run executed and did not pass. That is a result, not a fault: no
    // error framing, and the user decides whether to open it rather than
    // being navigated there.
    const view = viewRunAction("View run");
    toaster.create({
      title: "Scenario did not pass",
      description: "The run finished. Open it to see the criteria and the reasoning.",
      type: "warning",
      ...(view ? { action: { label: view.label, onClick: view.run } } : {}),
    });
    return;
  }

  if (result.error === "run_error") {
    // No error travels: the poll classified a terminal status rather than
    // catching a failure, so there is no code for the registry to read and the
    // screen's own line is the whole of what is known.
    const view = viewRunAction("View failed run");
    showErrorToast({
      fallbackTitle: "Scenario run failed",
      description: "The scenario encountered an error during execution.",
      ...(view ? { action: view } : {}),
    });
    return;
  }

  showErrorToast({
    fallbackTitle: "Run timed out",
    description: "The scenario run took too long to start. Please try again.",
  });
}

export function useRunScenario({
  projectId,
  projectSlug,
  onQueued,
  onRunComplete,
  onRunFailed,
}: UseRunScenarioOptions) {
  const utils = api.useUtils();
  const runMutation = api.scenarios.run.useMutation();
  const [isPolling, setIsPolling] = useState(false);

  // Check if any model providers are configured
  const { hasEnabledProviders } = useModelProvidersSettings({
    projectId,
  });

  const runScenario = useCallback(
    async (params: RunScenarioParams) => {
      const { scenarioId, target, setId, batchRunId, note, parameters } = params;
      if (!projectId || !projectSlug || !target) return;

      // Check if model providers are configured before attempting to run
      if (!hasEnabledProviders) {
        // A browser-side gate: no failure crossed a wire, so there is no code
        // for the registry to read and the screen's own line is the whole of
        // what is known. The link that fixes it is the point of the notice, and
        // it rides on the port's action slot.
        showErrorToast({
          fallbackTitle: "No model provider configured",
          description: "A model provider must be configured to run scenarios.",
          action: {
            label: "Configure model providers",
            run: () => window.open("/settings/model-providers", "_blank", "noopener,noreferrer"),
          },
        });
        return;
      }

      try {
        const { setId: returnedSetId, batchRunId: returnedBatchRunId } =
          await runMutation.mutateAsync({
            projectId,
            scenarioId,
            target: { type: target.type, referenceId: target.id },
            setId,
            batchRunId,
            note,
            parameters,
          });

        onQueued?.({ setId: returnedSetId, batchRunId: returnedBatchRunId });

        setIsPolling(true);
        const result = await pollForScenarioRun({
          // The poll asks for the same input up to 60 times over 30s. Under the
          // app-wide staleTime (30_000, see utils/api.tsx) every call after the
          // first would be answered from the first one's cached result, so the
          // loop would never see the run start and would always time out.
          // retry:false is equally load-bearing — fetchQuery only defaults
          // retry off when it is undefined, and the app defines it globally, so
          // one failing request would otherwise burn the entire budget on
          // backoff inside a single attempt.
          fetchBatchRunData: (pollParams) =>
            utils.scenarios.getBatchRunData.fetch(pollParams, {
              staleTime: 0,
              retry: false,
            }),
          params: {
            projectId,
            scenarioSetId: returnedSetId,
            batchRunId: returnedBatchRunId,
          },
        });

        if (result.success) {
          onRunComplete?.({
            scenarioRunId: result.scenarioRunId,
            setId: returnedSetId,
            batchRunId: returnedBatchRunId,
          });
        } else {
          reportRunOutcome({
            result,
            setId: returnedSetId,
            batchRunId: returnedBatchRunId,
            onRunFailed,
          });
        }
      } catch (error) {
        showErrorToast({ error, fallbackTitle: "Couldn't start the scenario" });
      } finally {
        setIsPolling(false);
      }
    },
    [
      projectId,
      projectSlug,
      hasEnabledProviders,
      runMutation,
      onQueued,
      onRunComplete,
      onRunFailed,
      utils,
    ],
  );

  return {
    runScenario,
    isRunning: runMutation.isPending || isPolling,
  };
}
