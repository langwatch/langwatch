import type { NormalizedSpan } from "@langwatch/trace-contract";

export type TraceIoSide = "input" | "output";

export type TraceIoValue = {
  raw: unknown;
  text: string;
  source: "gen_ai" | "langwatch";
};

export abstract class TraceIoExtractionPort {
  abstract tryExtractRichIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null;

  abstract tryExtractFallbackIOFromSpan(
    span: NormalizedSpan,
    side: TraceIoSide,
  ): TraceIoValue | null;
}
