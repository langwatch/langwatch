import type { TraceQueryClassifier } from "../../features/query/services/trace-query-classification.service.ts";

export class TestTraceQueryClassification implements TraceQueryClassifier {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}
