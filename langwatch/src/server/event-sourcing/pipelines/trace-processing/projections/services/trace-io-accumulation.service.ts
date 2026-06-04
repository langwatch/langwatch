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
 * Codex's instrumentation scope varies across versions (codex_exec
 * service.name in 0.131, just `codex` in some 0.13x builds), so we
 * gate on the event.name prefix instead — every cost-bearing event
 * codex emits is named `codex.<thing>` and that's stable across
 * builds.
 */
const CODEX_EVENT_NAME_PREFIX = "codex.";

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
    // Gate on event.name === "user_prompt" specifically. Without this
    // gate ANY claude_code log record with a `prompt` attribute wins,
    // including internal subagent calls (e.g. a Bash tool subagent
    // emitting `prompt:"env"`) which pollute the trace input with the
    // shell command instead of the user's real prompt. The
    // OTEL_LOG_USER_PROMPTS=1 env (set by the langwatch wrapper) is
    // what gets the user prompt onto the wire — and it lands on the
    // user_prompt event, never on tool/subagent events.
    if (data.attributes["event.name"] === "user_prompt") {
      const prompt = data.attributes.prompt;
      if (prompt && typeof prompt === "string") {
        return { input: prompt, output: null };
      }
    }
  }

  // Codex emits the user's text on a separate codex.user_prompt event.
  // Cost-bearing codex.sse_event events carry no prompt — input lift
  // happens here so the fold can pair it with the model/token lift
  // from extractCodexSseEventMetrics on the same trace.
  const codexEventName = data.attributes["event.name"];
  if (
    typeof codexEventName === "string" &&
    codexEventName.startsWith(CODEX_EVENT_NAME_PREFIX)
  ) {
    if (codexEventName === "codex.user_prompt") {
      const prompt = data.attributes.prompt;
      if (typeof prompt === "string" && prompt.length > 0) {
        return { input: prompt, output: null };
      }
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
