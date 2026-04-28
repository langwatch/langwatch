import { parsePromptReference } from "~/server/traces/parsePromptReference";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

const ATTR_PROMPT_SELECTED_ID = "langwatch.prompt.selected.id";

interface PromptAccumulation {
  containsPrompt: boolean;
  selectedPromptId: string | null;
  selectedPromptSpanId: string | null;
  selectedPromptStartTimeMs: number | null;
  lastUsedPromptId: string | null;
  lastUsedPromptVersionNumber: number | null;
  lastUsedPromptVersionId: string | null;
  lastUsedPromptSpanId: string | null;
  lastUsedPromptStartTimeMs: number | null;
}

/**
 * Walks one span and updates the trace's prompt rollup. Each rollup field
 * (selected / last-used) tracks the latest source span by `startTimeUnixMs`,
 * with SpanId as a deterministic tiebreaker.
 */
export class TracePromptAccumulationService {
  accumulate({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): PromptAccumulation {
    let next: PromptAccumulation = {
      containsPrompt: state.containsPrompt,
      selectedPromptId: state.selectedPromptId,
      selectedPromptSpanId: state.selectedPromptSpanId,
      selectedPromptStartTimeMs: state.selectedPromptStartTimeMs,
      lastUsedPromptId: state.lastUsedPromptId,
      lastUsedPromptVersionNumber: state.lastUsedPromptVersionNumber,
      lastUsedPromptVersionId: state.lastUsedPromptVersionId,
      lastUsedPromptSpanId: state.lastUsedPromptSpanId,
      lastUsedPromptStartTimeMs: state.lastUsedPromptStartTimeMs,
    };

    const selectedRaw = span.spanAttributes[ATTR_PROMPT_SELECTED_ID];
    if (typeof selectedRaw === "string" && selectedRaw.length > 0) {
      if (
        isLater({
          candidateMs: span.startTimeUnixMs,
          candidateSpanId: span.spanId,
          currentMs: next.selectedPromptStartTimeMs,
          currentSpanId: next.selectedPromptSpanId,
        })
      ) {
        next = {
          ...next,
          selectedPromptId: selectedRaw,
          selectedPromptSpanId: span.spanId,
          selectedPromptStartTimeMs: span.startTimeUnixMs,
          containsPrompt: true,
        };
      } else {
        next = { ...next, containsPrompt: true };
      }
    }

    const ref = parsePromptReference(span.spanAttributes);
    if (ref.promptHandle) {
      if (
        isLater({
          candidateMs: span.startTimeUnixMs,
          candidateSpanId: span.spanId,
          currentMs: next.lastUsedPromptStartTimeMs,
          currentSpanId: next.lastUsedPromptSpanId,
        })
      ) {
        next = {
          ...next,
          lastUsedPromptId: ref.promptHandle,
          lastUsedPromptVersionNumber: ref.promptVersionNumber,
          lastUsedPromptVersionId: ref.promptVersionId,
          lastUsedPromptSpanId: span.spanId,
          lastUsedPromptStartTimeMs: span.startTimeUnixMs,
          containsPrompt: true,
        };
      } else {
        next = { ...next, containsPrompt: true };
      }
    }

    return next;
  }
}

function isLater({
  candidateMs,
  candidateSpanId,
  currentMs,
  currentSpanId,
}: {
  candidateMs: number;
  candidateSpanId: string;
  currentMs: number | null;
  currentSpanId: string | null;
}): boolean {
  if (currentMs === null || currentSpanId === null) return true;
  if (candidateMs > currentMs) return true;
  if (candidateMs < currentMs) return false;
  return candidateSpanId > currentSpanId;
}
