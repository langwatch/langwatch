import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import {
  extractAssistantTextFromResponseBody,
  isConversationalQuerySource,
} from "~/server/app-layer/traces/canonicalisation/extractors/claudeCode";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  RESERVED_INPUT_MEDIA_REFS,
  RESERVED_OUTPUT_MEDIA_REFS,
  serializeMediaRefs,
} from "~/shared/traces/media-refs";
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
 * Priority: root (latest-finishing among roots) > explicit > last-finishing.
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
  // A parentless span is "root". A claude_code Path B turn synthesizes MANY
  // parentless spans under one trace (one per model call), so "root" is not
  // unique here: among roots the latest-finishing reply wins, so the trace
  // output is deterministic by end time instead of last-folded-wins (the real
  // reply often sits on a middle call, with utility calls finishing after it).
  // A root still beats a non-root child that set the output. For a conventional
  // single-root trace this is a no-op — there is only ever one root.
  if (isRoot) return !outputFromRoot || endTime >= currentEndTime;
  if (outputFromRoot) return false;
  if (isExplicit && !currentIsExplicit) return true;
  if (isExplicit === currentIsExplicit && endTime >= currentEndTime)
    return true;
  return false;
}

type LogRecordIO = { input: string | null; output: string | null };

function extractSpringAiIO(
  data: LogRecordReceivedEventData,
): LogRecordIO | undefined {
  const [identifier, ...contentParts] = data.body.split("\n");
  const content = contentParts.join("\n");
  if (!identifier || !content) return { input: null, output: null };
  if (identifier === "Chat Model Prompt Content:")
    return { input: content, output: null };
  if (identifier === "Chat Model Completion:")
    return { input: null, output: content };
  return undefined;
}

function queryIsConversational(data: LogRecordReceivedEventData): boolean {
  return isConversationalQuerySource(
    typeof data.attributes.query_source === "string"
      ? data.attributes.query_source
      : null,
  );
}

// Gate on event.name === "user_prompt" specifically. Without this
// gate ANY claude_code log record with a `prompt` attribute wins,
// including internal subagent calls (e.g. a Bash tool subagent
// emitting `prompt:"env"`) which pollute the trace input with the
// shell command instead of the user's real prompt. The
// OTEL_LOG_USER_PROMPTS=1 env (set by the langwatch wrapper) is
// what gets the user prompt onto the wire — and it lands on the
// user_prompt event, never on tool/subagent events.
function extractClaudeCodeUserPromptIO(
  data: LogRecordReceivedEventData,
): LogRecordIO | undefined {
  if (data.attributes["event.name"] !== "user_prompt") return undefined;
  const prompt = data.attributes.prompt;
  if (prompt && typeof prompt === "string") {
    return { input: prompt, output: null };
  }
  return undefined;
}

// OTEL_LOG_RAW_API_BODIES=1 emits a `claude_code.api_response_body`
// log record per turn carrying the FULL anthropic /v1/messages
// response body. The assistant's reply text lives in
// `body.content[]` where `type === "text"`. We extract the
// concatenated text and return it as ComputedOutput so trace
// summaries render real assistant replies instead of NULL.
//
// Gate on query_source: claude emits api_response_body for its
// non-conversational utility calls too (prompt_suggestion autosuggest,
// generate_session_title), whose text is NOT the assistant's reply.
// Because ComputedOutput is last-write-wins, an unfiltered title or
// autosuggest clobbers the real reply — so only lift from genuine
// conversation turns. This mirrors the gate in claudeCode.ts's
// liftApiResponseBody (the canonical span path); both reuse the same
// isConversationalQuerySource allowlist so the two output paths agree.
function extractClaudeCodeApiResponseBodyIO(
  data: LogRecordReceivedEventData,
): LogRecordIO | undefined {
  if (
    data.attributes["event.name"] !== "api_response_body" ||
    !queryIsConversational(data)
  )
    return undefined;
  const responseText = extractAssistantTextFromResponseBody(
    data.attributes.body,
  );
  return responseText !== null
    ? { input: null, output: responseText }
    : undefined;
}

// LIGHT path: without OTEL_LOG_RAW_API_BODIES the reply text rides an
// `assistant_response` event (attribute `response`) and no
// api_response_body exists in the session — the two events are
// per-session alternatives carrying the same reply text, so accepting
// both at the same rank cannot double-lift. Same conversational gate as
// above: utility replies (autosuggest, session titles) must not clobber
// the headline output.
function extractClaudeCodeAssistantResponseIO(
  data: LogRecordReceivedEventData,
): LogRecordIO | undefined {
  if (
    data.attributes["event.name"] !== "assistant_response" ||
    !queryIsConversational(data)
  )
    return undefined;
  const response = data.attributes.response;
  return typeof response === "string" && response.length > 0
    ? { input: null, output: response }
    : undefined;
}

function extractClaudeCodeIO(
  data: LogRecordReceivedEventData,
): LogRecordIO | undefined {
  return (
    extractClaudeCodeUserPromptIO(data) ??
    extractClaudeCodeApiResponseBodyIO(data) ??
    extractClaudeCodeAssistantResponseIO(data)
  );
}

// Codex emits the user's text on a separate codex.user_prompt event.
// Cost-bearing codex.sse_event events carry no prompt — input lift
// happens here so the fold can pair it with the model/token lift
// from extractCodexSseEventMetrics on the same trace.
function extractCodexIO(
  data: LogRecordReceivedEventData,
): LogRecordIO | undefined {
  const codexEventName = data.attributes["event.name"];
  const isCodexEvent =
    typeof codexEventName === "string" &&
    codexEventName.startsWith(CODEX_EVENT_NAME_PREFIX);
  if (!isCodexEvent || codexEventName !== "codex.user_prompt") return undefined;

  const prompt = data.attributes.prompt;
  if (typeof prompt === "string" && prompt.length > 0) {
    return { input: prompt, output: null };
  }
  return undefined;
}

/**
 * Extracts I/O from log records (Spring AI and Claude Code).
 */
export function extractIOFromLogRecord(
  data: LogRecordReceivedEventData,
): LogRecordIO {
  if (SPRING_AI_SCOPE_NAMES.has(data.scopeName)) {
    const result = extractSpringAiIO(data);
    if (result) return result;
  }

  if (CLAUDE_CODE_SCOPE_NAMES.has(data.scopeName)) {
    const result = extractClaudeCodeIO(data);
    if (result) return result;
  }

  const codexResult = extractCodexIO(data);
  if (codexResult) return codexResult;

  return { input: null, output: null };
}

type AccumulatedIO = {
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

function resolveGuardrailBlocked(
  span: NormalizedSpan,
  previouslyBlocked: boolean,
): boolean {
  if (span.spanAttributes[ATTR_KEYS.SPAN_TYPE] !== "guardrail")
    return previouslyBlocked;
  const rawOutput = span.spanAttributes[ATTR_KEYS.LANGWATCH_OUTPUT];
  if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    if ((rawOutput as Record<string, unknown>).passed === false) return true;
  }
  return previouslyBlocked;
}

// Claude Code utility model calls (prompt_suggestion autosuggest,
// generate_session_title) are not the conversation — their reply is now
// attached to the span (so the span detail shows it) but must NOT become
// the trace's headline I/O. Mirrors the log-path gate in
// extractIOFromLogRecord so both agree.
function isClaudeUtilitySpan(span: NormalizedSpan): boolean {
  const claudeQuerySource = span.spanAttributes["claude_code.query_source"];
  return (
    typeof claudeQuerySource === "string" &&
    !isConversationalQuerySource(claudeQuerySource)
  );
}

// Tool spans never define the trace's headline I/O: they are
// sub-operations (a Bash run, an Edit), not the conversation. This is
// load-bearing for synthesized claude_code tool spans, which are
// parentless (= root) so their langwatch.input would otherwise hijack the
// trace input. Skipping them lets a tool span carry its own input/output
// for the span detail without polluting the trace summary.
function shouldSkipSpanForIO(span: NormalizedSpan): boolean {
  const spanType = span.spanAttributes[ATTR_KEYS.SPAN_TYPE];
  return (
    spanType === "evaluation" ||
    spanType === "guardrail" ||
    spanType === "tool" ||
    isClaudeUtilitySpan(span)
  );
}

/**
 * Media refs follow the same winner as the computed text: whenever a
 * span's IO becomes the trace's headline input/output, its media parts
 * (already externalized to /api/files references) become the trace-level
 * media refs — ComputedInput is flattened text, so this is the only place
 * the list and drawer summary can learn about the trace's media.
 */
function readCurrentIOFlags(state: TraceSummaryData): {
  currentOutputSource: string;
  currentInputIsFallback: boolean;
  currentOutputIsFallback: boolean;
  inputMediaRefs: string | null;
  outputMediaRefs: string | null;
} {
  return {
    currentOutputSource:
      state.attributes["langwatch.reserved.output_source"] ??
      OUTPUT_SOURCE.INFERRED,
    currentInputIsFallback:
      state.attributes["langwatch.reserved.input_is_fallback"] === "true",
    currentOutputIsFallback:
      state.attributes["langwatch.reserved.output_is_fallback"] === "true",
    inputMediaRefs: state.attributes[RESERVED_INPUT_MEDIA_REFS] ?? null,
    outputMediaRefs: state.attributes[RESERVED_OUTPUT_MEDIA_REFS] ?? null,
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
  }): AccumulatedIO {
    const {
      currentOutputSource,
      currentInputIsFallback,
      currentOutputIsFallback,
      inputMediaRefs,
      outputMediaRefs,
    } = readCurrentIOFlags(state);

    const blockedByGuardrail = resolveGuardrailBlocked(
      span,
      state.blockedByGuardrail,
    );

    if (shouldSkipSpanForIO(span)) {
      return {
        computedInput: state.computedInput,
        computedOutput: state.computedOutput,
        outputFromRootSpan: state.outputFromRootSpan,
        outputSpanEndTimeMs: state.outputSpanEndTimeMs,
        outputSource: currentOutputSource,
        blockedByGuardrail,
        inputIsFallback: currentInputIsFallback,
        outputIsFallback: currentOutputIsFallback,
        inputMediaRefs,
        outputMediaRefs,
      };
    }

    const isRoot = span.parentSpanId === null;

    const {
      computedInput,
      inputIsFallback,
      inputMediaRefs: resolvedInputMediaRefs,
    } = this.resolveInputForSpan({
      span,
      isRoot,
      computedInput: state.computedInput,
      currentInputIsFallback,
      inputMediaRefs,
    });

    const {
      computedOutput,
      outputFromRootSpan,
      outputSpanEndTimeMs,
      outputSource,
      outputIsFallback,
      outputMediaRefs: resolvedOutputMediaRefs,
    } = this.resolveOutputForSpan({
      span,
      isRoot,
      computedOutput: state.computedOutput,
      outputFromRootSpan: state.outputFromRootSpan,
      outputSpanEndTimeMs: state.outputSpanEndTimeMs,
      outputSource: currentOutputSource,
      currentOutputIsFallback,
      outputMediaRefs,
    });

    return {
      computedInput,
      computedOutput,
      outputFromRootSpan,
      outputSpanEndTimeMs,
      outputSource,
      blockedByGuardrail,
      inputIsFallback,
      outputIsFallback,
      inputMediaRefs: resolvedInputMediaRefs,
      outputMediaRefs: resolvedOutputMediaRefs,
    };
  }

  private resolveInputForSpan({
    span,
    isRoot,
    computedInput,
    currentInputIsFallback,
    inputMediaRefs,
  }: {
    span: NormalizedSpan;
    isRoot: boolean;
    computedInput: string | null;
    currentInputIsFallback: boolean;
    inputMediaRefs: string | null;
  }): {
    computedInput: string | null;
    inputIsFallback: boolean;
    inputMediaRefs: string | null;
  } {
    const inputResult = this.traceIOExtractionService.extractRichIOFromSpan(
      span,
      "input",
    );
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
      return {
        computedInput: preferText(inputResult.text, inputResult.raw),
        inputIsFallback: false,
        inputMediaRefs: serializeMediaRefs(inputResult.raw),
      };
    }
    if (!inputResult && computedInput === null) {
      // Semantic heuristics didn't find anything. Fall back to the
      // service's `text` (best-effort stringification of the wrapper)
      // so ComputedInput is non-null when the span has real data,
      // but ONLY if no prior span already contributed a semantic match.
      const inputFallback =
        this.traceIOExtractionService.extractFallbackIOFromSpan(span, "input");
      if (inputFallback) {
        return {
          computedInput: preferText(inputFallback.text, inputFallback.raw),
          inputIsFallback: true,
          inputMediaRefs: serializeMediaRefs(inputFallback.raw),
        };
      }
    }
    return {
      computedInput,
      inputIsFallback: currentInputIsFallback,
      inputMediaRefs,
    };
  }

  private resolveOutputForSpan({
    span,
    isRoot,
    computedOutput,
    outputFromRootSpan,
    outputSpanEndTimeMs,
    outputSource,
    currentOutputIsFallback,
    outputMediaRefs,
  }: {
    span: NormalizedSpan;
    isRoot: boolean;
    computedOutput: string | null;
    outputFromRootSpan: boolean;
    outputSpanEndTimeMs: number;
    outputSource: string;
    currentOutputIsFallback: boolean;
    outputMediaRefs: string | null;
  }): {
    computedOutput: string | null;
    outputFromRootSpan: boolean;
    outputSpanEndTimeMs: number;
    outputSource: string;
    outputIsFallback: boolean;
    outputMediaRefs: string | null;
  } {
    const outputResult = this.traceIOExtractionService.extractRichIOFromSpan(
      span,
      "output",
    );
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
          currentIsExplicit: outputSource === OUTPUT_SOURCE.EXPLICIT,
          endTime: span.endTimeUnixMs,
          currentEndTime: outputSpanEndTimeMs,
        });
      if (shouldOverride) {
        // Use the extracted text (unwrapped from common JSON wrappers
        // like `{"output":"..."}`), not the raw payload. See input
        // branch above for the full rationale.
        return {
          computedOutput: preferText(outputResult.text, outputResult.raw),
          outputFromRootSpan: isRoot,
          outputSpanEndTimeMs: span.endTimeUnixMs,
          outputSource: isExplicit
            ? OUTPUT_SOURCE.EXPLICIT
            : OUTPUT_SOURCE.INFERRED,
          outputIsFallback: false,
          outputMediaRefs: serializeMediaRefs(outputResult.raw),
        };
      }
    } else if (computedOutput === null) {
      // No semantic match on any span so far. A stringified-payload fallback
      // is strictly better than leaving ComputedOutput NULL. Tracked via
      // outputIsFallback so a later-arriving semantic match can override it
      // regardless of span end-time ordering. outputFromRootSpan stays unset
      // so the next semantic root-span match still wins.
      const outputFallback =
        this.traceIOExtractionService.extractFallbackIOFromSpan(span, "output");
      if (outputFallback) {
        return {
          computedOutput: preferText(outputFallback.text, outputFallback.raw),
          outputFromRootSpan,
          outputSpanEndTimeMs: span.endTimeUnixMs,
          outputSource,
          outputIsFallback: true,
          outputMediaRefs: serializeMediaRefs(outputFallback.raw),
        };
      }
    }
    return {
      computedOutput,
      outputFromRootSpan,
      outputSpanEndTimeMs,
      outputSource,
      outputIsFallback: currentOutputIsFallback,
      outputMediaRefs,
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
