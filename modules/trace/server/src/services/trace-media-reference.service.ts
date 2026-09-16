import {
  collectMediaRefs,
  mergeMediaRefs,
  parseMediaRefs,
  serializeMediaRefList,
  type TraceMediaRef,
} from "@langwatch/trace-contract";
import {
  type TraceMediaReferenceResolver,
  type TraceMediaReference,
} from "../app/trace.members.ts";

/** Media reference serialization: shared format between write and read paths
 * prevents parsing failures that hide thumbnails. */
export class TraceMediaReferenceAdapter implements TraceMediaReferenceResolver {
  static create(): TraceMediaReferenceAdapter {
    return new TraceMediaReferenceAdapter();
  }

  private constructor() {
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

  serialize(references: TraceMediaReference[]): string | null {
    return serializeMediaRefList(references as TraceMediaRef[]);
  }
}
