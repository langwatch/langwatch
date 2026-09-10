import { TraceQueryClassifier } from "../../app/trace.infrastructure.ts";

export class TestTraceQueryClassification implements TraceQueryClassifier {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}
