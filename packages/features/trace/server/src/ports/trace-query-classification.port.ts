import type { TraceQueryClassification } from "@langwatch/trace-contract";

/** Composition port for the canonical Trace query grammar during its migration. */
export abstract class TraceQueryClassificationPort {
  abstract classify(query: string): TraceQueryClassification;
}
