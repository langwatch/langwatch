import type { TraceQueryClassification } from "@langwatch/trace-contract";

import { TraceQueryClassificationPort } from "../ports/trace-query-classification.port";
import { queryNeeds } from "../services/trace-query-evaluation.service";

export class TraceQueryClassificationAdapter extends TraceQueryClassificationPort {
  private constructor() {
    super();
  }

  static create(): TraceQueryClassificationAdapter {
    return new TraceQueryClassificationAdapter();
  }

  classify(query: string): TraceQueryClassification {
    const needs = queryNeeds(query);

    return {
      evaluations: needs.has("evaluations"),
      events: needs.has("events"),
      spans: needs.has("spans"),
    };
  }
}
