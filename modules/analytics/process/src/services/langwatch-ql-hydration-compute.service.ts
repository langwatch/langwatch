/**
 * Step 4 of the hydration stage: one value per distinct key. Every value is a
 * thin call into a renderer the product already uses, so a query and the trace
 * drawer answer with the same text rather than two renderings that drift.
 * @see specs/lwql/app-functions.feature
 */

import {
  LangWatchQLAppFunctionHydrationFailedError,
  type LangWatchQLAppFunctionOption,
} from "@langwatch/analytics-contract";
import type { Trace } from "@langwatch/trace-contract";

import type { LangWatchQLAppFunctionDefinition } from "../rules/langwatch-ql-app-function-shapes.rules.ts";
import { capLangWatchQLValue } from "../rules/langwatch-ql-hydration-assembly.rules.ts";
import {
  type LangWatchQLComputedValue,
  type LangWatchQLComputedValues,
  type LangWatchQLResolvedCall,
  LWQL_NOT_RESOLVED,
} from "../rules/langwatch-ql-hydration-plan.rules.ts";
import {
  orderThreadTraces,
  threadTraceIds,
  threadTracesUntil,
} from "../rules/langwatch-ql-hydration-threads.rules.ts";
import type { LangWatchQLFetchedTraces } from "./langwatch-ql-hydration-read.service.ts";

/** Which side of a captured call a messages function answers with. */
export type LangWatchQLMessagesSide = "both" | "input" | "output";

/** One named span's messages, and whether the trace holds that span at all. */
export interface LangWatchQLRenderedSpanMessages {
  readonly isSpanPresent: boolean;
  readonly json: string | null;
}

/**
 * The renderings hydration asks the Trace peer for. Every one of them already
 * has a reader in the product — the drawer's transcript, the evaluators' span
 * digest, the export serialiser — and none is re-implemented here.
 */
export interface LangWatchQLTraceRenderer {
  /** The thread as one markdown transcript, the traces already ordered and cut. */
  renderThreadTranscript(input: {
    threadKey: string;
    traces: readonly Trace[];
    /** Absent for the unbounded `conversation`. */
    maxTokens?: number;
  }): Promise<string>;
  /** The trace as the LLM-readable span digest, under a token budget. */
  renderReadableTrace(input: { trace: Trace; maxTokens: number }): Promise<string>;
  /** The trace's chat messages as JSON; null when it carries no conversation. */
  renderTraceMessages(input: {
    trace: Trace;
    side: LangWatchQLMessagesSide;
  }): Promise<string | null>;
  renderSpanMessages(input: {
    trace: Trace;
    spanId: string;
  }): Promise<LangWatchQLRenderedSpanMessages>;
  /** The whole trace as one JSON object, spans included. */
  renderTraceJson(input: { trace: Trace }): Promise<string>;
}

/** The `side` each messages function answers with. */
const MESSAGES_SIDES: Readonly<Record<string, LangWatchQLMessagesSide>> = {
  llm_messages: "both",
  llm_input_messages: "input",
  llm_output_messages: "output",
};

/**
 * An option the validator already proved is a literal of the declared type,
 * re-checked loudly: a mismatch would otherwise reach a renderer as NaN and
 * produce a plausible wrong budget.
 */
function numberOption({
  definition,
  options,
  at,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  at: number;
}): number {
  const option = options[at];
  if (typeof option !== "number" || !Number.isFinite(option)) {
    throw new Error(
      `lwql hydration: "${definition.name}" needs a numeric option at position ${at}`,
    );
  }

  return option;
}

function stringOption({
  definition,
  options,
  at,
}: {
  definition: LangWatchQLAppFunctionDefinition;
  options: readonly LangWatchQLAppFunctionOption[];
  at: number;
}): string {
  const option = options[at];
  if (typeof option !== "string") {
    throw new Error(`lwql hydration: "${definition.name}" needs a string option at position ${at}`);
  }

  return option;
}

export class LangWatchQLHydrationComputeService {
  private constructor(private readonly renderer: LangWatchQLTraceRenderer) {}

  static create({
    renderer,
  }: {
    renderer: LangWatchQLTraceRenderer;
  }): LangWatchQLHydrationComputeService {
    return new LangWatchQLHydrationComputeService(renderer);
  }

  /**
   * The extraction functions' values, computed once per distinct key. An eval
   * function's value is a judgement, which is the caller's own business.
   */
  async computeValues({
    resolved,
    traces,
    maxHydratedValueBytes,
  }: {
    resolved: readonly LangWatchQLResolvedCall[];
    traces: LangWatchQLFetchedTraces;
    maxHydratedValueBytes: number;
  }): Promise<LangWatchQLComputedValues> {
    const computed = new Map<string, ReadonlyMap<string, LangWatchQLComputedValue>>();
    try {
      for (const entry of resolved) {
        if (entry.definition.kind !== "extraction") continue;
        const perKey = new Map<string, LangWatchQLComputedValue>();
        for (const [keyId, parts] of entry.keys) {
          perKey.set(
            keyId,
            capLangWatchQLValue({
              computed: await this.computeValue({
                definition: entry.definition,
                options: entry.call.options,
                parts,
                traces,
              }),
              maxBytes: maxHydratedValueBytes,
            }),
          );
        }
        computed.set(entry.call.column, perKey);
      }
    } catch (error) {
      throw new LangWatchQLAppFunctionHydrationFailedError({
        reasons: [error instanceof Error ? error : new Error(String(error))],
      });
    }

    return computed;
  }

  /** One key's value, for one extraction function called with these options. */
  async computeValue({
    definition,
    options,
    parts,
    traces,
  }: {
    definition: LangWatchQLAppFunctionDefinition;
    options: readonly LangWatchQLAppFunctionOption[];
    parts: readonly string[];
    traces: LangWatchQLFetchedTraces;
  }): Promise<LangWatchQLComputedValue> {
    const [first, second] = parts;
    if (first === undefined) return LWQL_NOT_RESOLVED;

    if (definition.keyKind === "thread") {
      return this.#computeThreadValue({
        definition,
        options,
        threadKey: first,
        threadTraces: traces.byThread.get(first) ?? [],
      });
    }

    const trace = traces.byId.get(first);
    if (!trace) return LWQL_NOT_RESOLVED;

    return this.#computeTraceValue({ definition, options, trace, spanId: second });
  }

  async #computeThreadValue({
    definition,
    options,
    threadKey,
    threadTraces,
  }: {
    definition: LangWatchQLAppFunctionDefinition;
    options: readonly LangWatchQLAppFunctionOption[];
    threadKey: string;
    threadTraces: readonly Trace[];
  }): Promise<LangWatchQLComputedValue> {
    if (threadTraces.length === 0) return LWQL_NOT_RESOLVED;
    const { name } = definition;

    if (name === "thread_traces") {
      return {
        value: threadTraceIds({ traces: threadTraces }),
        isTruncated: false,
        isResolved: true,
      };
    }

    const isBounded = name === "conversation_bounded";
    const ordered = threadTracesUntil({
      traces: orderThreadTraces(threadTraces),
      untilTraceId: isBounded ? stringOption({ definition, options, at: 1 }) : "",
    });
    const transcript = await this.renderer.renderThreadTranscript({
      threadKey,
      traces: ordered,
      ...(isBounded ? { maxTokens: numberOption({ definition, options, at: 0 }) } : {}),
    });

    return { value: transcript, isTruncated: false, isResolved: true };
  }

  async #computeTraceValue({
    definition,
    options,
    trace,
    spanId,
  }: {
    definition: LangWatchQLAppFunctionDefinition;
    options: readonly LangWatchQLAppFunctionOption[];
    trace: Trace;
    spanId: string | undefined;
  }): Promise<LangWatchQLComputedValue> {
    const { name } = definition;

    if (name === "llm_readable_trace") {
      const value = await this.renderer.renderReadableTrace({
        trace,
        maxTokens: numberOption({ definition, options, at: 0 }),
      });
      return { value, isTruncated: false, isResolved: true };
    }

    if (name === "llm_messages_span") {
      if (spanId === undefined) return LWQL_NOT_RESOLVED;
      const rendered = await this.renderer.renderSpanMessages({ trace, spanId });
      return { value: rendered.json, isTruncated: false, isResolved: rendered.isSpanPresent };
    }

    if (name === "trace_json") {
      return {
        value: await this.renderer.renderTraceJson({ trace }),
        isTruncated: false,
        isResolved: true,
      };
    }

    const side = MESSAGES_SIDES[name];
    if (side === undefined) {
      throw new Error(`lwql hydration: no compute is wired for the app function "${name}"`);
    }

    return {
      value: await this.renderer.renderTraceMessages({ trace, side }),
      isTruncated: false,
      isResolved: true,
    };
  }
}
