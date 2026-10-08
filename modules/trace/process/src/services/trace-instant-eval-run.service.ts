/**
 * The runs an Explorer read's `eval` chips name, checked against the run
 * service another module owns. Starting, pricing and reading runs are the peer's.
 */
import type { InstantEvalApi, InstantEvalRunReference } from "@langwatch/instant-eval-contract";
import type { ResolvedInstantEvalRun } from "@langwatch/trace-contract";

import { toResolvedInstantEvalRun } from "../rules/trace-instant-eval-run.rules.ts";

/** What this service is composed from: the peer that owns the runs. */
interface TraceInstantEvalRunDeps {
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
