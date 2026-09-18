/**
 * The fixtures both hydration suites drive: a trace, a trace source that
 * answers from two fixed lists and records what it was asked, and the call
 * into the stage with the shipped ceilings filled in.
 *
 * Shared rather than duplicated so the two suites cannot drift into testing
 * two different fakes.
 *
 * @see ../hydrate.ts
 */
import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import { hydrateLangWatchQLAppFunctions } from "../hydrate";
import type {
  InstantEvalHydrationSupport,
  LangWatchQLHydrationLimits,
} from "../hydration/contract";
import type { LangWatchQLAppFunctionTraceSource } from "../traceSource";

export const PROTECTIONS: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
} as Protections;

export const LIMITS: LangWatchQLHydrationLimits = {
  maxHydratedBytes: 32_000_000,
  maxHydratedValueBytes: 4_000_000,
};

/** A trace carrying trace-level text, which is what the drawer reads first. */
export function trace({
  traceId,
  threadKey,
  input = "hello",
  output = "hi there",
  startedAt = 1_700_000_000_000,
  spans = [],
}: {
  traceId: string;
  threadKey?: string;
  input?: string;
  output?: string;
  startedAt?: number;
  spans?: Trace["spans"];
}): Trace {
  return {
    trace_id: traceId,
    project_id: "project-a",
    metadata: threadKey === undefined ? {} : { thread_id: threadKey },
    timestamps: {
      started_at: startedAt,
      inserted_at: startedAt,
      updated_at: startedAt,
    },
    ...(input === "" ? {} : { input: { value: input } }),
    ...(output === "" ? {} : { output: { value: output } }),
    spans,
  } as Trace;
}

/** A source answering from two fixed lists, and counting what it was asked. */
export function sourceOf({
  traces = [],
  threadTraces = [],
}: {
  traces?: Trace[];
  threadTraces?: Trace[];
} = {}): LangWatchQLAppFunctionTraceSource & {
  askedTraceIds: string[][];
  askedThreadKeys: string[][];
} {
  const askedTraceIds: string[][] = [];
  const askedThreadKeys: string[][] = [];
  return {
    askedTraceIds,
    askedThreadKeys,
    async tracesByIds({ traceIds }) {
      askedTraceIds.push([...traceIds]);
      return traces.filter((candidate) =>
        traceIds.includes(candidate.trace_id),
      );
    },
    async tracesByThreadKeys({ threadKeys }) {
      askedThreadKeys.push([...threadKeys]);
      return threadTraces.filter((candidate) => {
        const key = candidate.metadata.thread_id;
        return typeof key === "string" && threadKeys.includes(key);
      });
    },
  };
}

export const hydrate = (input: {
  calls: Parameters<typeof hydrateLangWatchQLAppFunctions>[0]["calls"];
  columns: Parameters<typeof hydrateLangWatchQLAppFunctions>[0]["columns"];
  rows: Record<string, unknown>[];
  traceSource: LangWatchQLAppFunctionTraceSource;
  limits?: LangWatchQLHydrationLimits;
  instantEvals?: InstantEvalHydrationSupport;
  signal?: AbortSignal;
}) =>
  hydrateLangWatchQLAppFunctions({
    projectIds: ["project-a"],
    protections: PROTECTIONS,
    limits: input.limits ?? LIMITS,
    ...input,
  });
