import type { TraceQueryClassification } from "@langwatch/trace-contract";

import { TraceQueryClassifier } from "../app/trace.members.ts";
import { ClickhouseTraceQueryEvaluationRepository } from "../repositories/clickhouse/clickhouse.trace-query-evaluation.repository.ts";

export class TraceQueryClassificationAdapter implements TraceQueryClassifier {
  private constructor() {
  }

  static create(): TraceQueryClassificationAdapter {
    return new TraceQueryClassificationAdapter();
  }

  classify(query: string): TraceQueryClassification {
    const needs = ClickhouseTraceQueryEvaluationRepository.needs(query);

    return {
      evaluations: needs.has("evaluations"),
      events: needs.has("events"),
      spans: needs.has("spans"),
    };
  }
}
