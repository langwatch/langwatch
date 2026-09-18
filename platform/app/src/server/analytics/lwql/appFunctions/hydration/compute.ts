/**
 * Step 4 of the hydration stage: one value per distinct key.
 *
 * Every function here is a thin call into a renderer the product already uses,
 * so a query and the trace drawer answer with the same text rather than with
 * two renderings that drift.
 *
 * @see ../conversation.ts
 * @see ../traceValues.ts
 * @see ../hydrate.ts
 */

import type { Trace } from "~/server/tracer/types";
import { cutToEstimatedTokens } from "~/shared/traces/tokenBudget";
import { toError } from "~/utils/posthogErrorCapture";
import { LangWatchQLAppFunctionHydrationFailedError } from "../../errors";
import { renderThreadConversation, threadTraceIds } from "../conversation";
import {
  type LlmMessagesSide,
  renderReadableTrace,
  renderSpanMessages,
  renderTraceJson,
  renderTraceMessages,
} from "../traceValues";
import {
  type ComputedValue,
  type ComputedValues,
  type LangWatchQLHydrationInput,
  NOT_RESOLVED,
  type ResolvedCall,
} from "./contract";
import type { FetchedTraces } from "./read";

// ---------------------------------------------------------------------------
// Step 4 — compute once per distinct key
// ---------------------------------------------------------------------------

/** The computed values, per call column, per key. */

export async function computeValues({
  input,
  resolved,
  traces,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
  traces: FetchedTraces;
}): Promise<ComputedValues> {
  const computed = new Map<string, Map<string, ComputedValue>>();
  try {
    for (const entry of resolved) {
      const perKey = new Map<string, ComputedValue>();
      for (const [keyId, parts] of entry.keys) {
        perKey.set(
          keyId,
          capValue({
            computed: await computeOne({ entry, parts, traces }),
            maxBytes: input.limits.maxHydratedValueBytes,
          }),
        );
      }
      computed.set(entry.call.column, perKey);
    }
  } catch (error) {
    throw new LangWatchQLAppFunctionHydrationFailedError({
      reasons: [toError(error)],
    });
  }
  return computed;
}

/** One key's value, for one call. */
async function computeOne({
  entry,
  parts,
  traces,
}: {
  entry: ResolvedCall;
  parts: readonly string[];
  traces: FetchedTraces;
}): Promise<ComputedValue> {
  const [first, second] = parts;
  if (first === undefined) return NOT_RESOLVED;

  if (entry.definition.keyKind === "thread") {
    return computeThreadValue({
      entry,
      threadKey: first,
      threadTraces: traces.byThread.get(first) ?? [],
    });
  }

  const trace = traces.byId.get(first);
  if (!trace) return NOT_RESOLVED;
  return await computeTraceValue({ entry, trace, spanId: second });
}

function computeThreadValue({
  entry,
  threadKey,
  threadTraces,
}: {
  entry: ResolvedCall;
  threadKey: string;
  threadTraces: readonly Trace[];
}): ComputedValue {
  if (threadTraces.length === 0) return NOT_RESOLVED;
  const { name } = entry.definition;

  if (name === "thread_traces") {
    return {
      value: threadTraceIds({ traces: threadTraces }),
      isTruncated: false,
      isResolved: true,
    };
  }

  const transcript = renderThreadConversation({
    threadKey,
    traces: threadTraces,
    ...(name === "conversation_bounded"
      ? {
          maxTokens: numberOption({ entry, at: 0 }),
          untilTraceId: stringOption({ entry, at: 1 }),
        }
      : {}),
  });
  return { value: transcript, isTruncated: false, isResolved: true };
}

/** The `side` each messages function answers with. */
const MESSAGES_SIDES: Readonly<Record<string, LlmMessagesSide>> = {
  llm_messages: "both",
  llm_input_messages: "input",
  llm_output_messages: "output",
};

async function computeTraceValue({
  entry,
  trace,
  spanId,
}: {
  entry: ResolvedCall;
  trace: Trace;
  spanId: string | undefined;
}): Promise<ComputedValue> {
  const { name } = entry.definition;

  if (name === "llm_readable_trace") {
    return {
      value: await renderReadableTrace({
        trace,
        maxTokens: numberOption({ entry, at: 0 }),
      }),
      isTruncated: false,
      isResolved: true,
    };
  }

  if (name === "llm_messages_span") {
    if (spanId === undefined) return NOT_RESOLVED;
    const rendered = renderSpanMessages({ trace, spanId });
    return {
      value: rendered.json,
      isTruncated: false,
      isResolved: rendered.isSpanPresent,
    };
  }

  if (name === "trace_json") {
    return {
      value: renderTraceJson({ trace }),
      isTruncated: false,
      isResolved: true,
    };
  }

  const side = MESSAGES_SIDES[name];
  if (side === undefined) {
    throw new Error(
      `lwql hydration: no compute is wired for the app function "${name}"`,
    );
  }
  return {
    value: renderTraceMessages({ trace, side }),
    isTruncated: false,
    isResolved: true,
  };
}

/**
 * An option the validator already proved is a literal of the declared type.
 *
 * Re-checked anyway, and loudly: the plan is built by one module and read by
 * another, and a mismatch would otherwise reach a renderer as `NaN` and produce
 * a plausible-looking wrong budget.
 */
function numberOption({
  entry,
  at,
}: {
  entry: ResolvedCall;
  at: number;
}): number {
  const option = entry.call.options[at];
  if (typeof option !== "number" || !Number.isFinite(option)) {
    throw new Error(
      `lwql hydration: "${entry.definition.name}" needs a numeric option at position ${at}`,
    );
  }
  return option;
}

function stringOption({
  entry,
  at,
}: {
  entry: ResolvedCall;
  at: number;
}): string {
  const option = entry.call.options[at];
  if (typeof option !== "string") {
    throw new Error(
      `lwql hydration: "${entry.definition.name}" needs a string option at position ${at}`,
    );
  }
  return option;
}

/**
 * Cuts one value to the per-value ceiling.
 *
 * Only a string value is cut. The one list-valued function returns a thread's
 * trace ids, which the thread read itself bounds at a thousand — tens of
 * kilobytes, orders of magnitude under the ceiling — so a cut there would be
 * dead code pretending to be a safeguard.
 *
 * The cut goes through the shared token cutter at a quarter of the byte budget,
 * which is exactly a byte cut on a UTF-8 boundary: a cut landing mid-character
 * would otherwise ship a replacement character.
 */
function capValue({
  computed,
  maxBytes,
}: {
  computed: ComputedValue;
  maxBytes: number;
}): ComputedValue {
  const { value } = computed;
  if (typeof value !== "string") return computed;
  if (new TextEncoder().encode(value).length <= maxBytes) return computed;
  return {
    ...computed,
    value: cutToEstimatedTokens({
      text: value,
      maxTokens: Math.floor(maxBytes / 4),
    }),
    isTruncated: true,
  };
}
