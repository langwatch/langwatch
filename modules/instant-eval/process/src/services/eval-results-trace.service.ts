/**
 * A trace's kept Instant Evals results for its drawer (ADR-189 section 3), behind
 * `release_instant_eval_results`: off, nothing is read and the drawer shows none.
 * @see modules/instant-eval/specs/instant-eval-results.feature
 */

import {
  INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS,
  type InstantEvalTraceResultWire,
} from "@langwatch/instant-eval-contract";

import type { EvalResultsRepository } from "../repositories/eval-results.repository.ts";
import {
  EVAL_RESULTS_KEY_VERSION,
  EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
} from "../rules/eval-results-key.rules.ts";
import { toInstantEvalTraceResultWire } from "../rules/eval-results-trace.rules.ts";

/** What this service asks of other modules, narrowed to the one answer it needs. */
export interface EvalResultsTracePeers {
  /** Whether the project keeps its results: `release_instant_eval_results`. */
  isReleased(input: { projectId: string }): Promise<boolean>;
}

export class EvalResultsTraceService {
  private constructor(
    private readonly results: Pick<EvalResultsRepository, "findLatestByTrace">,
    private readonly peers: EvalResultsTracePeers,
  ) {}

  static create({
    results,
    peers,
  }: {
    results: Pick<EvalResultsRepository, "findLatestByTrace">;
    peers: EvalResultsTracePeers;
  }): EvalResultsTraceService {
    return new EvalResultsTraceService(results, peers);
  }

  /**
   * The trace's latest result per span, question and judged column, newest first. The window is
   * padded as recall's is, so a row a span statement wrote at the span's time is still found,
   * and cut to {@link INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS} from its start.
   */
  async findResultsByTrace(input: {
    projectId: string;
    traceId: string;
    occurredFrom: number;
    occurredUntil: number;
  }): Promise<InstantEvalTraceResultWire[]> {
    if (!(await this.peers.isReleased({ projectId: input.projectId }))) return [];

    const widestUntil = input.occurredFrom + INSTANT_EVAL_TRACE_RESULTS_MAX_WINDOW_MS;
    const occurredUntil = Math.min(input.occurredUntil, widestUntil);
    const results = await this.results.findLatestByTrace({
      tenantId: input.projectId,
      traceId: input.traceId,
      keyVersion: EVAL_RESULTS_KEY_VERSION,
      occurredFrom: input.occurredFrom - EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
      occurredUntil: occurredUntil + EVAL_RESULTS_RECALL_WINDOW_PADDING_MS,
    });
    return results.flatMap(toInstantEvalTraceResultWire);
  }
}
