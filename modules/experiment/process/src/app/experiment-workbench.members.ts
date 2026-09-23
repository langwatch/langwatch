// Types the workbench composes beyond the experiment application: its run loop
// and two best-effort sinks. Live here so app can answer them.
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { ExperimentRunProgressRepository } from "../repositories/experiment-run-progress.repository.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import type { ExecutionDataServices } from "../services/experiment-execution-data.service.ts";
import type { StartPollingRunInput } from "../services/experiment-polling-run.service.ts";

/**
 * One polling run, as a transport asks for it: the run, and nothing about the
 * process it runs on.
 */
export type ExperimentV3StartRunInput = Omit<
  StartPollingRunInput,
  "ports" | "workflows" | "progress" | "baseUrl" | "defaultConcurrency"
> &
  Readonly<{ defaultConcurrency?: number }>;

/**
 * The run loop this process composed, or the holes where it did not.
 */
export type ExperimentV3RunLoop = Readonly<{
  ports: ExperimentRunCollaborators | null;
  progress: ExperimentRunProgressRepository | null;
  services: ExecutionDataServices;
  // The same `WorkflowApi` the orchestrator's own collaborators are typed
  // against (see `rules/experiment-run-input.rules.ts`): a transport only
  // forwards it, but it forwards the real dependency, not an opaque one.
  workflows: WorkflowApi;
  defaultConcurrency: number;
  startRun(
    input: ExperimentV3StartRunInput,
  ): Promise<{ runId: string; runUrl: string; total: number }>;
}>;

/**
 * The two best-effort sinks a workbench run reports through. Neither is a
 * decision the run waits on: where this deployment records neither, the
 * member's own methods do nothing and the run is unaffected.
 */
export type ExperimentWorkbenchObserver = Readonly<{
  /** Records that a person ran an experiment. */
  recordExperimentRan(
    input: Readonly<{
      userId: string;
      projectId: string;
      experimentId: string | undefined;
      isFullRun: boolean;
    }>,
  ): void;
  /** Where an unnamed failure is reported. */
  reportError(error: unknown, context: Readonly<Record<string, unknown>>): void;
}>;
