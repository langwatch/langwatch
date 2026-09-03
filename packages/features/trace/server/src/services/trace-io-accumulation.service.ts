import { ATTR_KEYS, type TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE,
  TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE,
  TraceMediaReferencePort,
} from "../ports/trace-media-reference.port";
import { TraceIoExtractionPort } from "../ports/trace-io-extraction.port";
import type { LogRecordReceivedEventData } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";

export const OUTPUT_SOURCE = {
  EXPLICIT: "explicit",
  INFERRED: "inferred",
} as const;

/**
 * The attributes a side's media can ride on. Both are read for every span,
 * because the two carry different things: the provider instrumentation writes
 * the request the customer sent to `langwatch.*`, while `gen_ai.*.messages`
 * holds what that instrumentation chose to report, which is often the text
 * alone. Reading only whichever one named the trace loses the picture whenever
 * the other one is the one holding it.
 */
const MEDIA_SOURCE_ATTRS = {
  input: [ATTR_KEYS.LANGWATCH_INPUT, ATTR_KEYS.GEN_AI_INPUT_MESSAGES],
  output: [ATTR_KEYS.LANGWATCH_OUTPUT, ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES],
} as const;

/**
 * One span's contribution to the trace's headline input and output.
 *
 * `accumulateIO` returns this whole shape every time rather than mutating the
 * summary, so each rule below is a value a caller can read, and none of them
 * depend on the order the others ran in.
 */
export type TraceIOAccumulation = {
  computedInput: string | null;
  computedOutput: string | null;
  outputFromRootSpan: boolean;
  outputSpanEndTimeMs: number;
  outputSource: string;
  blockedByGuardrail: boolean;
  inputIsFallback: boolean;
  outputIsFallback: boolean;
  /** Compact JSON media refs for the winning input/output, or null. */
  inputMediaRefs: string | null;
  outputMediaRefs: string | null;
};

/**
 * Accumulates computed input/output across spans using priority rules:
 * root > explicit (langwatch) > last-finishing inferred (gen_ai).
 */
export class TraceIOAccumulationService {
  private constructor(
    private readonly traceIOExtractionService: TraceIoExtractionPort,
    private readonly traceCanonicalisation: TraceCanonicalisationService,
    private readonly mediaReferences: TraceMediaReferencePort,
  ) {}

  static create(
    traceIOExtractionService: TraceIoExtractionPort,
    traceCanonicalisation: TraceCanonicalisationService,
    mediaReferences: TraceMediaReferencePort,
  ): TraceIOAccumulationService {
    return new TraceIOAccumulationService(
      traceIOExtractionService,
      traceCanonicalisation,
      mediaReferences,
    );
  }

  accumulateIO({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): TraceIOAccumulation {
    const carried = TraceIOAccumulationService.carriedForward(state);
    const blockedByGuardrail = carried.blockedByGuardrail || this.blocksOnGuardrail(span);

    if (this.cannotDefineHeadlineIO(span)) {
      return { ...carried, blockedByGuardrail };
    }

    const isRoot = span.parentSpanId === null;

    return {
      ...carried,
      ...this.accumulateInput({ carried, span, isRoot }),
      ...this.accumulateOutput({ carried, span, isRoot }),
      blockedByGuardrail,
    };
  }

  /** A guardrail that reports it did not pass blocks the whole trace. */
  private blocksOnGuardrail(span: NormalizedSpan): boolean {
    if (span.spanAttributes[ATTR_KEYS.SPAN_TYPE] !== "guardrail") {
      return false;
    }
    const rawOutput = span.spanAttributes[ATTR_KEYS.LANGWATCH_OUTPUT];

    return (
      typeof rawOutput === "object" &&
      rawOutput !== null &&
      !Array.isArray(rawOutput) &&
      (rawOutput as Record<string, unknown>).passed === false
    );
  }

  /**
   * Span kinds that carry their own input and output but must never become the
   * trace's headline text.
   *
   * Tool spans are the load-bearing case: synthesized claude_code tool spans are
   * parentless, so they read as roots, and without this a Bash run's input would
   * hijack the trace's. Skipping them lets a tool span keep its own I/O for the
   * span detail without reaching the summary.
   */
  private cannotDefineHeadlineIO(span: NormalizedSpan): boolean {
    const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];

    return (
      spanType === "evaluation" ||
      spanType === "guardrail" ||
      spanType === "tool" ||
      this.isClaudeUtilityCall(span)
    );
  }

  /**
   * Claude Code's utility model calls — autosuggest, session titles — are not
   * the conversation. They are parentless like tool spans, so a title could
   * otherwise win the headline on end time. Mirrors the log-path gate in
   * `TraceLogRecordIOService` so both agree.
   */
  private isClaudeUtilityCall(span: NormalizedSpan): boolean {
    const querySource = span.spanAttributes["claude_code.query_source"];

    return (
      typeof querySource === "string" &&
      !this.traceCanonicalisation.classifyClaudeCall({ querySource }).conversational
    );
  }

  private accumulateInput({
    carried,
    span,
    isRoot,
  }: {
    carried: TraceIOAccumulation;
    span: NormalizedSpan;
    isRoot: boolean;
  }): Pick<TraceIOAccumulation, "computedInput" | "inputIsFallback" | "inputMediaRefs"> {
    const rich = this.traceIOExtractionService.tryExtractRichIOFromSpan(span, "input");

    // A root restates the whole trace's input, so it always wins. A child only
    // fills a gap, or replaces a stringified fallback with a semantic match.
    const richWins =
      rich !== null && (isRoot || carried.computedInput === null || carried.inputIsFallback);

    // Only reached when nothing semantic has been found on any span so far: a
    // best-effort stringification beats leaving ComputedInput null, and the
    // flag is what lets a later semantic match take over.
    const fallback =
      rich === null && carried.computedInput === null
        ? this.traceIOExtractionService.tryExtractFallbackIOFromSpan(span, "input")
        : null;

    const winner = richWins ? rich : fallback;

    return {
      // The EXTRACTED text, not the raw payload: extraction already unwraps
      // `{"output":"Hey"}` to `Hey`. Re-stringifying `raw` here is what put
      // wrapper JSON in trace summaries in the 2026-05-14 regression.
      computedInput:
        winner === null
          ? carried.computedInput
          : TraceIOAccumulationService.preferText(winner.text, winner.raw),
      inputIsFallback: winner === null ? carried.inputIsFallback : winner === fallback,
      inputMediaRefs: TraceIOAccumulationService.accumulateMediaRefs({
        serialized: carried.inputMediaRefs,
        span,
        side: "input",
        winning: winner !== null,
        mediaReferences: this.mediaReferences,
      }),
    };
  }

  private accumulateOutput({
    carried,
    span,
    isRoot,
  }: {
    carried: TraceIOAccumulation;
    span: NormalizedSpan;
    isRoot: boolean;
  }): Omit<
    TraceIOAccumulation,
    "computedInput" | "inputIsFallback" | "inputMediaRefs" | "blockedByGuardrail"
  > {
    const rich = this.traceIOExtractionService.tryExtractRichIOFromSpan(span, "output");
    const isExplicit = rich?.source === "langwatch";

    // A semantic match always displaces a fallback, whatever the end times say:
    // the fallback span often finishes AFTER the real gen_ai span, so the
    // end-time comparison on its own would keep the fallback forever.
    const richWins =
      rich !== null &&
      (carried.outputIsFallback ||
        TraceIOAccumulationService.shouldOverrideOutput({
          isRoot,
          outputFromRoot: carried.outputFromRootSpan,
          isExplicit,
          currentIsExplicit: carried.outputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: span.endTimeUnixMs,
          currentEndTime: carried.outputSpanEndTimeMs,
        }));

    const fallback =
      rich === null && carried.computedOutput === null
        ? this.traceIOExtractionService.tryExtractFallbackIOFromSpan(span, "output")
        : null;

    const mediaRefs = (winning: boolean): string | null =>
      TraceIOAccumulationService.accumulateMediaRefs({
        serialized: carried.outputMediaRefs,
        span,
        side: "output",
        winning,
        mediaReferences: this.mediaReferences,
      });

    if (richWins && rich !== null) {
      return {
        computedOutput: TraceIOAccumulationService.preferText(rich.text, rich.raw),
        outputFromRootSpan: isRoot,
        outputSpanEndTimeMs: span.endTimeUnixMs,
        outputSource: isExplicit ? OUTPUT_SOURCE.EXPLICIT : OUTPUT_SOURCE.INFERRED,
        outputIsFallback: false,
        outputMediaRefs: mediaRefs(true),
      };
    }

    if (fallback !== null) {
      return {
        computedOutput: TraceIOAccumulationService.preferText(fallback.text, fallback.raw),
        // Deliberately NOT set from `isRoot`, and the source is left alone: a
        // fallback must not claim the root slot, so the next semantic
        // root-span match still wins.
        outputFromRootSpan: carried.outputFromRootSpan,
        outputSpanEndTimeMs: span.endTimeUnixMs,
        outputSource: carried.outputSource,
        outputIsFallback: true,
        outputMediaRefs: mediaRefs(true),
      };
    }

    return {
      computedOutput: carried.computedOutput,
      outputFromRootSpan: carried.outputFromRootSpan,
      outputSpanEndTimeMs: carried.outputSpanEndTimeMs,
      outputSource: carried.outputSource,
      outputIsFallback: carried.outputIsFallback,
      outputMediaRefs: mediaRefs(false),
    };
  }

  /**
   * Priority: root (latest-finishing among roots) > explicit > last-finishing.
   * @internal Exported for unit testing
   */
  static shouldOverrideOutput({
    isRoot,
    outputFromRoot,
    isExplicit,
    currentIsExplicit,
    endTime,
    currentEndTime,
  }: {
    isRoot: boolean;
    outputFromRoot: boolean;
    isExplicit: boolean;
    currentIsExplicit: boolean;
    endTime: number;
    currentEndTime: number;
  }): boolean {
    // A parentless span is "root". A claude_code Path B turn synthesizes MANY
    // parentless spans under one trace (one per model call), so "root" is not
    // unique here: among roots the latest-finishing reply wins, so the trace
    // output is deterministic by end time instead of last-folded-wins (the real
    // reply often sits on a middle call, with utility calls finishing after it).
    // A root still beats a non-root child that set the output. For a conventional
    // single-root trace this is a no-op — there is only ever one root.
    if (isRoot) {
      return !outputFromRoot || endTime >= currentEndTime;
    }
    if (outputFromRoot) {
      return false;
    }
    if (isExplicit && !currentIsExplicit) {
      return true;
    }
    if (isExplicit === currentIsExplicit && endTime >= currentEndTime) {
      return true;
    }
    return false;
  }

  /**
   * Fold one span's media into the trace's running refs for a side.
   *
   * A span with no media leaves the refs alone, which is the whole point: the
   * span that names the trace is usually not the span that holds the picture, so
   * winning the headline text must not wipe what another span contributed. The
   * winning span's media goes first, so the list thumbnail still prefers the
   * media of the headline message.
   */
  private static accumulateMediaRefs({
    serialized,
    span,
    side,
    winning,
    mediaReferences,
  }: {
    serialized: string | null;
    span: NormalizedSpan;
    side: "input" | "output";
    winning: boolean;
    mediaReferences: TraceMediaReferencePort;
  }): string | null {
    const incoming = MEDIA_SOURCE_ATTRS[side].flatMap((key) => {
      const value = span.spanAttributes[key];

      return value === undefined || value === null ? [] : mediaReferences.collect(value);
    });
    if (incoming.length === 0) {
      return serialized;
    }
    return mediaReferences.trySerialize(
      mediaReferences.merge({
        existing: mediaReferences.parse(serialized),
        incoming,
        precedence: winning ? "prepend" : "append",
      }),
    );
  }

  /**
   * The trace's answer so far, before this span is folded in.
   *
   * Several of these live in `attributes` rather than as columns, so reading them
   * in one place keeps the string keys out of the accumulation rules.
   */
  private static carriedForward(state: TraceSummaryData): TraceIOAccumulation {
    return {
      computedInput: state.computedInput,
      computedOutput: state.computedOutput,
      outputFromRootSpan: state.outputFromRootSpan,
      outputSpanEndTimeMs: state.outputSpanEndTimeMs,
      outputSource: state.attributes["langwatch.reserved.output_source"] ?? OUTPUT_SOURCE.INFERRED,
      blockedByGuardrail: state.blockedByGuardrail,
      inputIsFallback: state.attributes["langwatch.reserved.input_is_fallback"] === "true",
      outputIsFallback: state.attributes["langwatch.reserved.output_is_fallback"] === "true",
      inputMediaRefs: state.attributes[TRACE_INPUT_MEDIA_REFERENCE_ATTRIBUTE] ?? null,
      outputMediaRefs: state.attributes[TRACE_OUTPUT_MEDIA_REFERENCE_ATTRIBUTE] ?? null,
    };
  }

  /**
   * Prefer the extracted human-readable text over the raw payload.
   * The IO extraction service runs messagesToText / extractTextFromPlainJson
   * to unwrap common payload shapes (e.g. `{"output":"Hey"}` → `"Hey"`,
   * gen_ai messages → joined content text). When that succeeds, use it
   * for the trace summary. Fall back to stringifying the raw payload
   * only when extraction returned no text — keeps NON-null guarantee
   * for spans that have data but unknown shape.
   *
   * Exported via the existing accumulation surface — tests cover this
   * via the fold projection, not directly.
   */
  private static preferText(text: string | null | undefined, raw: unknown): string {
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
    if (typeof raw === "string") {
      return raw;
    }
    // JSON.stringify(undefined) returns the literal value `undefined`,
    // not the string "undefined". Guard explicitly so a future caller
    // that hands us `undefined` doesn't silently corrupt the trace
    // summary with a non-string value cast to string.
    if (raw === undefined) {
      return "";
    }
    return JSON.stringify(raw);
  }
}
