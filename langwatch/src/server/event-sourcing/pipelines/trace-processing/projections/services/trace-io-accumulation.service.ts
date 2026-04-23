import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { LogRecordReceivedEventData } from "../../schemas/events";
import type { NormalizedSpan } from "../../schemas/spans";

export const OUTPUT_SOURCE = {
  EXPLICIT: "explicit",
  INFERRED: "inferred",
} as const;

export const SPRING_AI_SCOPE_NAMES = new Set([
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
]);

export const CLAUDE_CODE_SCOPE_NAMES = new Set([
  "com.anthropic.claude_code.events",
]);

/**
 * Priority: root > explicit > last-finishing.
 * @internal Exported for unit testing
 */
export function shouldOverrideOutput({
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
  if (isRoot) return true;
  if (outputFromRoot) return false;
  if (isExplicit && !currentIsExplicit) return true;
  if (isExplicit === currentIsExplicit && endTime >= currentEndTime)
    return true;
  return false;
}

/**
 * Extracts I/O from log records (Spring AI and Claude Code).
 */
export function extractIOFromLogRecord(data: LogRecordReceivedEventData): {
  input: string | null;
  output: string | null;
} {
  if (SPRING_AI_SCOPE_NAMES.has(data.scopeName)) {
    const [identifier, ...contentParts] = data.body.split("\n");
    const content = contentParts.join("\n");
    if (!identifier || !content) return { input: null, output: null };
    if (identifier === "Chat Model Prompt Content:")
      return { input: content, output: null };
    if (identifier === "Chat Model Completion:")
      return { input: null, output: content };
  }

  if (CLAUDE_CODE_SCOPE_NAMES.has(data.scopeName)) {
    const prompt = data.attributes.prompt;
    if (prompt && typeof prompt === "string") {
      return { input: prompt, output: null };
    }
  }

  return { input: null, output: null };
}

/**
 * Accumulates computed input/output across spans using priority rules:
 * root > explicit (langwatch) > last-finishing inferred (gen_ai).
 */
export class TraceIOAccumulationService {
  constructor(
    private readonly traceIOExtractionService: TraceIOExtractionService,
  ) {}

  accumulateIO({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): {
    computedInput: string | null;
    computedOutput: string | null;
    outputFromRootSpan: boolean;
    outputSpanEndTimeMs: number;
    outputSource: string;
    blockedByGuardrail: boolean;
    inputIsFallback: boolean;
    outputIsFallback: boolean;
  } {
    const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
    const currentOutputSource =
      state.attributes["langwatch.reserved.output_source"] ??
      OUTPUT_SOURCE.INFERRED;
    const currentInputIsFallback =
      state.attributes["langwatch.reserved.input_is_fallback"] === "true";
    const currentOutputIsFallback =
      state.attributes["langwatch.reserved.output_is_fallback"] === "true";

    let computedInput = state.computedInput;
    let computedOutput = state.computedOutput;
    let outputFromRootSpan = state.outputFromRootSpan;
    let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
    let outputSource = currentOutputSource;
    let blockedByGuardrail = state.blockedByGuardrail;
    let inputIsFallback = currentInputIsFallback;
    let outputIsFallback = currentOutputIsFallback;

    if (spanType === "guardrail") {
      const rawOutput = span.spanAttributes[ATTR_KEYS.LANGWATCH_OUTPUT];
      if (
        rawOutput &&
        typeof rawOutput === "object" &&
        !Array.isArray(rawOutput)
      ) {
        if ((rawOutput as Record<string, unknown>).passed === false)
          blockedByGuardrail = true;
      }
    }

    if (spanType === "evaluation" || spanType === "guardrail") {
      return {
        computedInput,
        computedOutput,
        outputFromRootSpan,
        outputSpanEndTimeMs,
        outputSource,
        blockedByGuardrail,
        inputIsFallback,
        outputIsFallback,
      };
    }

    const isRoot = span.parentSpanId === null;

    const inputResult =
      this.traceIOExtractionService.extractRichIOFromSpan(span, "input");
    if (
      inputResult &&
      (isRoot || computedInput === null || currentInputIsFallback)
    ) {
      const raw = inputResult.raw;
      computedInput = typeof raw === "string" ? raw : JSON.stringify(raw);
      inputIsFallback = false;
    } else if (!inputResult && computedInput === null) {
      // Semantic heuristics didn't find anything. Fall back to a stringified
      // payload so ComputedInput is non-null when the span has real data,
      // but ONLY if no prior span already contributed a semantic match.
      const inputFallback =
        this.traceIOExtractionService.extractFallbackIOFromSpan(span, "input");
      if (inputFallback) {
        const raw = inputFallback.raw;
        computedInput = typeof raw === "string" ? raw : JSON.stringify(raw);
        inputIsFallback = true;
      }
    }

    const outputResult =
      this.traceIOExtractionService.extractRichIOFromSpan(span, "output");
    if (outputResult) {
      const isExplicit = outputResult.source === "langwatch";
      // Semantic output must always override a prior fallback, regardless of
      // end-time ordering. The fallback span's endTime can be later than a
      // real semantic gen_ai span that arrives afterward; without this bypass,
      // `shouldOverrideOutput`'s endTime comparison would keep the fallback.
      const shouldOverride =
        currentOutputIsFallback ||
        shouldOverrideOutput({
          isRoot,
          outputFromRoot: outputFromRootSpan,
          isExplicit,
          currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: span.endTimeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        });
      if (shouldOverride) {
        const raw = outputResult.raw;
        computedOutput = typeof raw === "string" ? raw : JSON.stringify(raw);
        outputFromRootSpan = isRoot;
        outputSpanEndTimeMs = span.endTimeUnixMs;
        outputSource = isExplicit
          ? OUTPUT_SOURCE.EXPLICIT
          : OUTPUT_SOURCE.INFERRED;
        outputIsFallback = false;
      }
    } else if (computedOutput === null) {
      // No semantic match on any span so far. A stringified-payload fallback
      // is strictly better than leaving ComputedOutput NULL. Tracked via
      // outputIsFallback so a later-arriving semantic match can override it
      // regardless of span end-time ordering. outputFromRootSpan stays unset
      // so the next semantic root-span match still wins.
      const outputFallback =
        this.traceIOExtractionService.extractFallbackIOFromSpan(
          span,
          "output",
        );
      if (outputFallback) {
        const raw = outputFallback.raw;
        computedOutput = typeof raw === "string" ? raw : JSON.stringify(raw);
        outputSpanEndTimeMs = span.endTimeUnixMs;
        outputIsFallback = true;
      }
    }

    return {
      computedInput,
      computedOutput,
      outputFromRootSpan,
      outputSpanEndTimeMs,
      outputSource,
      blockedByGuardrail,
      inputIsFallback,
      outputIsFallback,
    };
  }
}
