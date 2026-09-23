import { ExperimentRunLoopUnavailableError } from "@langwatch/experiment-contract";

import type { ExperimentV3RunLoop } from "../app/experiment-workbench.members.ts";
import type { ExperimentRunProgressRepository } from "../repositories/experiment-run-progress.repository.ts";
import type { ExperimentRunCollaborators } from "./experiment-run-input.rules.ts";

/** The run loop, or the refusal a process without one owes. Starting a run needs both halves. */
export function runLoopOf(run: ExperimentV3RunLoop): {
  ports: ExperimentRunCollaborators;
  progress: ExperimentRunProgressRepository;
} {
  if (!run.ports || !run.progress) {
    throw new ExperimentRunLoopUnavailableError("experiment run loop");
  }
  return { ports: run.ports, progress: run.progress };
}

/**
 * Where a run's progress is READ from. Only the progress half: a process that
 * composes the store but starts no runs of its own still answers a poll, and
 * gating that read on `ports` made every reader of a run a 503.
 */
export function runProgressOf(run: ExperimentV3RunLoop): ExperimentRunProgressRepository {
  if (!run.progress) throw new ExperimentRunLoopUnavailableError("experiment run progress store");

  return run.progress;
}
