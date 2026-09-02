import {
  collectMediaRefs,
  mergeMediaRefs,
  parseMediaRefs,
  serializeMediaRefList,
  type TraceMediaRef,
} from "@langwatch/trace-contract";
import {
  TraceMediaReferencePort,
  type TraceMediaReference,
} from "../ports/trace-media-reference.port";

/**
 * The compact media references the trace summary strips render, over the one
 * format module in `@langwatch/trace-contract`.
 *
 * Frozen twin of the application's `AppTraceMediaReferenceAdapter`
 * (`platform/app/src/runtime/app/trace-projections.adapter.ts`), which binds
 * the same four functions to the same four port methods. Both graphs therefore
 * write and read ONE serialisation — which is the whole point of the format
 * living in the contract: a reference this side minted and the read path could
 * not parse would show the customer no thumbnail and no reason.
 *
 * `TraceMediaReference` and `TraceMediaRef` are the same record; the port
 * declares its own so Trace's pipeline seam names no read-model type, and the
 * two are checked against each other here rather than cast apart.
 */
export class TraceMediaReferenceAdapter extends TraceMediaReferencePort {
  static create(): TraceMediaReferenceAdapter {
    return new TraceMediaReferenceAdapter();
  }

  private constructor() {
    super();
  }

  collect(value: unknown): TraceMediaReference[] {
    return collectMediaRefs(value);
  }

  parse(serialized: string | null): TraceMediaReference[] {
    return parseMediaRefs(serialized);
  }

  merge(input: {
    existing: TraceMediaReference[];
    incoming: TraceMediaReference[];
    precedence: "append" | "prepend";
  }): TraceMediaReference[] {
    return mergeMediaRefs({
      existing: input.existing as TraceMediaRef[],
      incoming: input.incoming as TraceMediaRef[],
      precedence: input.precedence,
    });
  }

  trySerialize(references: TraceMediaReference[]): string | null {
    return serializeMediaRefList(references as TraceMediaRef[]);
  }
}
