/**
 * The Explorer's Instant Evals, over the run service another module owns: the
 * search bar's vocabulary in, the run's counters out. The statement, the
 * budget and the judging are all the peer's.
 */
import type {
  InstantEvalApi,
  InstantEvalEstimateWire,
  InstantEvalRunProgress,
  InstantEvalRunReference,
} from "@langwatch/instant-eval-contract";
import type {
  ExplorerInstantEvalRunInput,
  ResolvedInstantEvalRun,
} from "@langwatch/trace-contract";

import {
  toExplorerRunInput,
  toExplorerRunProgress,
  toResolvedInstantEvalRun,
} from "../rules/trace-instant-eval-run.rules.ts";

/** What this service is composed from: the peer that owns the runs. */
export interface TraceInstantEvalRunDeps {
  instantEvals: InstantEvalApi;
}

export class TraceInstantEvalRunService {
  static create(deps: TraceInstantEvalRunDeps): TraceInstantEvalRunService {
    return new TraceInstantEvalRunService(deps.instantEvals);
  }

  #instantEvals: InstantEvalApi;
  private constructor(instantEvals: InstantEvalApi) {
    this.#instantEvals = instantEvals;
  }

  /** What the run would read and what judging it would cost, judging nothing. */
  estimateRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalEstimateWire> {
    return this.#instantEvals.estimateRun({
      projectId: input.request.projectId,
      actor: { kind: "member", userId: input.userId },
      input: toExplorerRunInput(input.request),
    });
  }

  async startRun(input: {
    request: ExplorerInstantEvalRunInput;
    userId: string;
  }): Promise<InstantEvalRunProgress> {
    const run = await this.#instantEvals.createRun({
      projectId: input.request.projectId,
      actor: { kind: "member", userId: input.userId },
      input: toExplorerRunInput(input.request),
    });

    return toExplorerRunProgress(run);
  }

  async cancelRun(input: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunProgress> {
    const run = await this.#instantEvals.cancelRun({
      projectId: input.projectId,
      runId: input.runId,
      ...(input.requestedByUserId === undefined
        ? {}
        : { requestedByUserId: input.requestedByUserId }),
    });

    return toExplorerRunProgress(run);
  }

  async getRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunProgress> {
    return toExplorerRunProgress(await this.#instantEvals.getRun(input));
  }

  /**
   * The runs a query's `eval` chips claim, checked against the project and
   * dated for the compiler. A claim this project does not own is dropped by
   * the peer, so the chip behind it stays pending and selects no rows.
   */
  async findRegisteredRuns(input: {
    projectId: string;
    references: readonly InstantEvalRunReference[];
  }): Promise<ResolvedInstantEvalRun[]> {
    if (input.references.length === 0) return [];
    const windows = await this.#instantEvals.findRunWindows(input);

    return windows.map(toResolvedInstantEvalRun);
  }
}
