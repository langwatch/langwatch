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
 * Lift cost / token / model fields off a Claude Code
 * `claude_code.api_request` log record into the canonical
 * `langwatch.*` attributes the trace UI renders.
 *
 * Anthropic semantics — preserved carefully:
 *   - `input_tokens`           = uncached input tokens (regular rate)
 *   - `output_tokens`          = output tokens
 *   - `cache_creation_tokens`  = tokens WRITTEN to cache (≥ 1.25× input rate)
 *   - `cache_read_tokens`      = tokens READ from cache (~0.1× input rate)
 * The two cache fields MUST NOT be swapped — they have very
 * different billing rates and any flip would silently misreport
 * customer cost. The unit suite includes an explicit regression
 * test asserting each lifted field by name.
 *
 * Returns `null` when the record is anything other than a
 * `claude_code.api_request` event so the caller can skip
 * application without an extra check.
 */
export function extractClaudeCodeApiRequestMetrics(
  data: LogRecordReceivedEventData,
): {
  model: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
} | null {
  if (!CLAUDE_CODE_SCOPE_NAMES.has(data.scopeName)) return null;
  const eventName = data.attributes["event.name"];
  if (eventName !== "api_request") return null;

  const asNumber = (key: string): number | null => {
    const raw = data.attributes[key];
    if (raw === undefined || raw === null || raw === "") return null;
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number(raw)
          : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const asString = (key: string): string | null => {
    const raw = data.attributes[key];
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  };

  return {
    model: asString("model"),
    costUsd: asNumber("cost_usd"),
    inputTokens: asNumber("input_tokens"),
    outputTokens: asNumber("output_tokens"),
    cacheReadTokens: asNumber("cache_read_tokens"),
    cacheCreationTokens: asNumber("cache_creation_tokens"),
  };
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
      // Use the EXTRACTED text — extractRichIOFromSpan already runs
      // messagesToText / extractTextFromPlainJson to pull the clean
      // human-readable string out of common wrappers (e.g. unwrap
      // `{"output":"Hey there"}` → `"Hey there"`). Discarding that and
      // re-stringifying `raw` is what caused the 2026-05-14 prod UX
      // regression where trace summaries showed the wrapper JSON
      // instead of the actual text.
      computedInput = preferText(inputResult.text, inputResult.raw);
      inputIsFallback = false;
    } else if (!inputResult && computedInput === null) {
      // Semantic heuristics didn't find anything. Fall back to the
      // service's `text` (best-effort stringification of the wrapper)
      // so ComputedInput is non-null when the span has real data,
      // but ONLY if no prior span already contributed a semantic match.
      const inputFallback =
        this.traceIOExtractionService.extractFallbackIOFromSpan(span, "input");
      if (inputFallback) {
        computedInput = preferText(inputFallback.text, inputFallback.raw);
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
        // Use the extracted text (unwrapped from common JSON wrappers
        // like `{"output":"..."}`), not the raw payload. See input
        // branch above for the full rationale.
        computedOutput = preferText(outputResult.text, outputResult.raw);
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
        computedOutput = preferText(outputFallback.text, outputFallback.raw);
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
function preferText(text: string | null | undefined, raw: unknown): string {
  if (typeof text === "string" && text.length > 0) return text;
  if (typeof raw === "string") return raw;
  // JSON.stringify(undefined) returns the literal value `undefined`,
  // not the string "undefined". Guard explicitly so a future caller
  // that hands us `undefined` doesn't silently corrupt the trace
  // summary with a non-string value cast to string.
  if (raw === undefined) return "";
  return JSON.stringify(raw);
}
