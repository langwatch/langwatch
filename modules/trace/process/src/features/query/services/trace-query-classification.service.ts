import type { TraceQueryClassification } from "@langwatch/trace-contract";

import type { TraceQueryEvaluationService } from "./trace-query-evaluation.service.ts";

/** Composition port for the canonical Trace query grammar during its migration. */
export interface TraceQueryClassifier {
  classify(query: string): TraceQueryClassification;
}

export class TraceQueryClassificationService implements TraceQueryClassifier {
  readonly #evaluation: TraceQueryEvaluationService;

  private constructor(evaluation: TraceQueryEvaluationService) {
    this.#evaluation = evaluation;
  }

  static create({
    evaluation,
  }: {
    evaluation: TraceQueryEvaluationService;
  }): TraceQueryClassificationService {
    return new TraceQueryClassificationService(evaluation);
  }

  classify(query: string): TraceQueryClassification {
    const needs = this.#evaluation.traceQueryFieldNeeds(query);

    return {
      evaluations: needs.has("evaluations"),
      events: needs.has("events"),
      spans: needs.has("spans"),
    };
  }
}
