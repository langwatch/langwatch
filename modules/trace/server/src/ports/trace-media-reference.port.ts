export type TraceMediaReference = {
  kind: "audio" | "file" | "image" | "video";
  url: string;
  filename?: string;
  mimeType?: string;
  role?: string;
};

export const TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE = "langwatch.reserved.media_refs.input";
export const TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE = "langwatch.reserved.media_refs.output";

export abstract class TraceMediaReferencePort {
  abstract collect(value: unknown): TraceMediaReference[];

  abstract parse(serialized: string | null): TraceMediaReference[];

  abstract merge(input: {
    existing: TraceMediaReference[];
    incoming: TraceMediaReference[];
    precedence: "append" | "prepend";
  }): TraceMediaReference[];

  abstract trySerialize(references: TraceMediaReference[]): string | null;
}
