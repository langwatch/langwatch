// Types the workbench composes beyond the experiment application: permission
// probe, run loop, and two best-effort sinks. Live here so app can answer them.
import type { AuthzPermission } from "@langwatch/authz-contract";

import type { ExperimentRunProgressRepository } from "../repositories/experiment-run-progress.repository.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import type { ExecutionDataServices } from "../services/experiment-execution-data.service.ts";
import type { StartPollingRunInput } from "../services/experiment-polling-run.service.ts";

/** The signed-in person the two workbench-run doors read. */
export type ExperimentV3RestSession = Readonly<{ user: Readonly<{ id: string }> }>;

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
  // `WorkflowService` is server-private to the workflow module; a transport
  // only forwards it into the orchestrator, so it is typed loosely rather than
  // naming that module's server package from here.
  workflows: unknown;
  defaultConcurrency: number;
  startRun(
    input: ExperimentV3StartRunInput,
  ): Promise<{ runId: string; runUrl: string; total: number }>;
}>;

/**
 * Whether the signed-in person behind a browser door holds one permission on
 * one project — resolved through the same authorization service every other
 * door asks, so two doors cannot decide differently about a person.
 */
export type ExperimentWorkbenchPermissions = Readonly<{
  permitted(
    input: Readonly<{
      session: ExperimentV3RestSession;
      projectId: string;
      permission: AuthzPermission;
    }>,
  ): Promise<boolean>;
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
