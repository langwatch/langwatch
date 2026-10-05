import {
  collectMediaRefs,
  mergeMediaRefs,
  parseMediaRefs,
  serializeMediaRefList,
  type TraceMediaRef,
} from "@langwatch/trace-contract";

export type TraceMediaReference = {
  kind: "audio" | "file" | "image" | "video";
  url: string;
  filename?: string;
  mimeType?: string;
  role?: string;
};

export const TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE = "langwatch.reserved.media_refs.input";

export const TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE = "langwatch.reserved.media_refs.output";

export interface TraceMediaReferenceResolver {
  collect(value: unknown): TraceMediaReference[];

  parse(serialized: string | null): TraceMediaReference[];

  merge(input: {
    existing: TraceMediaReference[];
    incoming: TraceMediaReference[];
    precedence: "append" | "prepend";
  }): TraceMediaReference[];

  serialize(references: TraceMediaReference[]): string | null;
}

/** Media reference serialization: shared format between write and read paths
 * prevents parsing failures that hide thumbnails. */
export class TraceMediaReferenceService implements TraceMediaReferenceResolver {
  static create(): TraceMediaReferenceService {
    return new TraceMediaReferenceService();
  }

  private constructor() {}

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
