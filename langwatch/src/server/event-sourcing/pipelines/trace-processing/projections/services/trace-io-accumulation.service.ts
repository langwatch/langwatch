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
  } {
    const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
    const currentOutputSource =
      state.attributes["langwatch.reserved.output_source"] ??
      OUTPUT_SOURCE.INFERRED;

    let computedInput = state.computedInput;
    let computedOutput = state.computedOutput;
    let outputFromRootSpan = state.outputFromRootSpan;
    let outputSpanEndTimeMs = state.outputSpanEndTimeMs;
    let outputSource = currentOutputSource;
    let blockedByGuardrail = state.blockedByGuardrail;

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
      };
    }

    const isRoot = span.parentSpanId === null;

    const inputResult =
      this.traceIOExtractionService.extractRichIOFromSpan(span, "input");
    if (inputResult && (isRoot || computedInput === null)) {
      const raw = inputResult.raw;
      computedInput = typeof raw === "string" ? raw : JSON.stringify(raw);
    }

    const outputResult =
      this.traceIOExtractionService.extractRichIOFromSpan(span, "output");
    if (outputResult) {
      const isExplicit = outputResult.source === "langwatch";
      if (
        shouldOverrideOutput({
          isRoot,
          outputFromRoot: outputFromRootSpan,
          isExplicit,
          currentIsExplicit: currentOutputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: span.endTimeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        })
      ) {
        const raw = outputResult.raw;
        computedOutput = typeof raw === "string" ? raw : JSON.stringify(raw);
        outputFromRootSpan = isRoot;
        outputSpanEndTimeMs = span.endTimeUnixMs;
        outputSource = isExplicit
          ? OUTPUT_SOURCE.EXPLICIT
          : OUTPUT_SOURCE.INFERRED;
      }
    }

    return {
      computedInput,
      computedOutput,
      outputFromRootSpan,
      outputSpanEndTimeMs,
      outputSource,
      blockedByGuardrail,
    };
  }
}
