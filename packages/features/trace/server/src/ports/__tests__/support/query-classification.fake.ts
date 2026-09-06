import { TraceQueryClassificationPort } from "../../trace-query-classification.port.ts";

export class TestTraceQueryClassification extends TraceQueryClassificationPort {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}
