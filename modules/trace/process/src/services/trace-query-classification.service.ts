import type { TraceQueryClassification } from "@langwatch/trace-contract";

import { traceQueryFieldNeeds } from "../rules/trace-query-evaluation.rules.ts";

/** Composition port for the canonical Trace query grammar during its migration. */
export interface TraceQueryClassifier {
  classify(query: string): TraceQueryClassification;
}

export class TraceQueryClassificationService implements TraceQueryClassifier {
  private constructor() {}

  static create(): TraceQueryClassificationService {
    return new TraceQueryClassificationService();
  }

  classify(query: string): TraceQueryClassification {
    const needs = traceQueryFieldNeeds(query);

    return {
      evaluations: needs.has("evaluations"),
      events: needs.has("events"),
      spans: needs.has("spans"),
    };
  }
}
