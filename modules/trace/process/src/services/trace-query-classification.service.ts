import type { TraceQueryClassification } from "@langwatch/trace-contract";

import { type TraceQueryClassifier } from "../app/trace.members.ts";
import { traceQueryFieldNeeds } from "../rules/trace-query-evaluation.rules.ts";

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
