import { useCallback, useState } from "react";
import { showErrorToast } from "~/features/errors";
import type { RunParameterValues } from "~/server/scenarios/parameters";
import type { TargetValue } from "../components/scenarios/TargetSelector";
import { toaster } from "../components/ui/toaster";
import { api } from "../utils/api";
import { type PollResult, pollForScenarioRun } from "../utils/pollForScenarioRun";
import { useModelProvidersSettings } from "./useModelProvidersSettings";

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
 * Builds the toast action that opens a finished run.
 *
 * Returns undefined when there is no run to open, and when the caller supplied
 * no `onRunFailed` handler — a button that does nothing when clicked is worse
 * than no button. `ScenarioFormDrawer` is such a caller.
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
}) {
  if (!scenarioRunId || !onRunFailed) return undefined;

  return {
    label,
    onClick: () => onRunFailed({ scenarioRunId, setId, batchRunId }),
  };
}

/**
 * Turns a poll result that is not a success into the toast the user sees.
 *
 * The three cases are genuinely different events, and saying so is the point of
 * this module: a run that did not pass produced an outcome, a run that errored
 * produced nothing, and a timeout means nothing became visible at all. Lives
 * outside the hook so the run callback stays about running the scenario.
 *
 * Note this is the only one of ~411 `toaster.create` call sites in the app that
 * passes a built config rather than an inline literal. That is not style: three
 * inline toasts put `runScenario` over `noExcessiveLinesPerFunction` (max 60)
 * and CI's Biome gate rejects it. Inlining these back will fail lint.
 */
function buildRunOutcomeToast({
  result,
  setId,
  batchRunId,
  onRunFailed,
}: {
  result: Extract<PollResult, { success: false }>;
  setId: string;
  batchRunId: string;
  onRunFailed: ((result: RunCompleteResult) => void) | undefined;
}) {
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
    return {
      title: "Scenario did not pass",
      description: "The run finished. Open it to see the criteria and the reasoning.",
      type: "warning" as const,
      action: viewRunAction("View run"),
    };
  }

  if (result.error === "run_error") {
    return {
      title: "Scenario run failed",
      description: "The scenario encountered an error during execution.",
      type: "error" as const,
      action: viewRunAction("View failed run"),
    };
  }

  return {
    title: "Run timed out",
    description: "The scenario run took too long to start. Please try again.",
    type: "error" as const,
  };
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
      const { scenarioId, target, setId, batchRunId, note, parameters } =
        params;
      if (!projectId || !projectSlug || !target) return;

      // Check if model providers are configured before attempting to run
      if (!hasEnabledProviders) {
        toaster.create({
          title: "No model provider configured",
          description: "A model provider must be configured to run scenarios.",
          type: "error",
          action: {
            label: "Configure model providers",
            onClick: () =>
              window.open("/settings/model-providers", "_blank", "noopener,noreferrer"),
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
          toaster.create(
            buildRunOutcomeToast({
              result,
              setId: returnedSetId,
              batchRunId: returnedBatchRunId,
              onRunFailed,
            }),
          );
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
