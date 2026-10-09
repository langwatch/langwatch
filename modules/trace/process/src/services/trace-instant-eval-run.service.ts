/**
 * The runs an Explorer read's `eval` chips name, checked against the run table
 * instant-eval shares with trace for reading (R40, round 47). Starting,
 * pricing and reading runs are instant-eval's.
 */
import {
  instantEvalSkewedWrittenWindow,
  type InstantEvalRunReference,
} from "@langwatch/instant-eval-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import type { ResolvedInstantEvalRun } from "@langwatch/trace-contract";

import type { TraceInstantEvalRunsReadRepository } from "../repositories/trace-instant-eval-runs.repository.ts";
import { toResolvedInstantEvalRun } from "../rules/trace-instant-eval-run.rules.ts";

export class TraceInstantEvalRunService {
  static create(deps: {
    runs: TraceInstantEvalRunsReadRepository;
    now?: () => Instant;
  }): TraceInstantEvalRunService {
    return new TraceInstantEvalRunService(deps.runs, deps.now ?? nowInstant);
  }

  private constructor(
    private readonly runs: TraceInstantEvalRunsReadRepository,
    private readonly now: () => Instant,
  ) {}

  /**
   * The runs a query's `eval` chips claim, checked against the project and
   * dated for the compiler. A claim this project did not record is dropped,
   * so the chip behind it stays pending and selects no rows.
   */
  async findRegisteredRuns(input: {
    projectId: string;
    references: readonly InstantEvalRunReference[];
  }): Promise<ResolvedInstantEvalRun[]> {
    if (input.references.length === 0) return [];
    const rows = await this.runs.findRunsByIds({
      projectId: input.projectId,
      runIds: input.references.map((reference) => reference.runId),
    });
    const byId = new Map(rows.map((row) => [row.runId, row]));
    const now = this.now();

    return input.references.flatMap((reference) => {
      const row = byId.get(reference.runId);
      if (!row) return [];
      return [
        toResolvedInstantEvalRun({
          question: reference.question,
          target: reference.target,
          runId: row.runId,
          ...instantEvalSkewedWrittenWindow(row, now),
        }),
      ];
    });
  }
}
