import type { TraceQueryClassifier } from "../../services/trace-query-classification.service.ts";

export class TestTraceQueryClassification implements TraceQueryClassifier {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}
