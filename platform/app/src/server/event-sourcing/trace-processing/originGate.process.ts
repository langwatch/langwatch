import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import type { traceEvents } from "./events";
import { extractOriginSignals } from "./originClassification";

export const ORIGIN_GATE_PROCESS_NAME = "originGate" as const;

/** Grace period before a trace with no evidence of its own origin gets the
 * fallback. `evaluationTrigger`'s dedup TTL is sized off this. */
export const ORIGIN_GATE_DEADLINE_MS = 5 * 60 * 1000;
export const ORIGIN_GATE_FALLBACK_ORIGIN = "application";
export const ORIGIN_GATE_FALLBACK_REASON = "deferred_fallback";

/** A resync/backfill flood, not a live trace — never worth arming a fallback for. */
const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

const ORIGIN_BEARING_SCOPES: ReadonlySet<string> = new Set([
  "langwatch-evaluation",
  "@langwatch/scenario",
]);

export const originGateStateSchema = z.object({
  resolved: z.boolean(),
  deadlineAt: z.number().nullable(),
  sdkSeen: z.boolean(),
});
export type OriginGateState = z.infer<typeof originGateStateSchema>;

export function initOriginGateState(): OriginGateState {
  return { resolved: false, deadlineAt: null, sdkSeen: false };
}

export const originGateResolveIntentSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
});
export type OriginGateResolveIntent = z.infer<
  typeof originGateResolveIntentSchema
>;

export interface OriginGateDispatchDeps {
  resolveOrigin(data: {
    tenantId: string;
    traceId: string;
    origin: string;
    reason: string;
  }): Promise<void>;
}

export function originGateIntents(deps: OriginGateDispatchDeps) {
  return {
    resolveOrigin: {
      payload: originGateResolveIntentSchema,
      messageKey: (payload) => `resolve-origin:${payload.traceId}`,
      deliver: (payload) =>
        deps.resolveOrigin({
          ...payload,
          origin: ORIGIN_GATE_FALLBACK_ORIGIN,
          reason: ORIGIN_GATE_FALLBACK_REASON,
        }),
    } satisfies IntentDef<typeof originGateResolveIntentSchema>,
  };
}
type OriginGateIntents = ReturnType<typeof originGateIntents>;

/** Whether this one span, on its own, is evidence the trace's origin is decided. */
function spanHasOriginEvidence(span: {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resourceAttributes: Readonly<Record<string, unknown>>;
  readonly instrumentationScopeName: string;
}): boolean {
  const signals = extractOriginSignals({
    spanId: "",
    parentSpanId: null,
    instrumentationScopeName: span.instrumentationScopeName,
    attributes: span.attributes,
    resourceAttributes: span.resourceAttributes,
  });
  return (
    signals.explicitOrigin !== undefined ||
    signals.hasEvaluationRunId ||
    signals.hasScenarioLabelsResource ||
    signals.metadataPlatform === "optimization_studio" ||
    (signals.instrumentationScopeName !== undefined &&
      ORIGIN_BEARING_SCOPES.has(signals.instrumentationScopeName))
  );
}

/** Close the gate for good: no deadline, and nothing can re-arm one. */
function closed(
  state: OriginGateState,
): EvolveStep<OriginGateState, OriginGateIntents> {
  return {
    state: { ...state, resolved: true, deadlineAt: null },
    intents: [],
    nextWakeAt: null,
  };
}

/** Leave the armed deadline exactly where it is. */
function unchanged(
  state: OriginGateState,
): EvolveStep<OriginGateState, OriginGateIntents> {
  return { state, intents: [], nextWakeAt: state.deadlineAt };
}

function evolveGate(
  state: OriginGateState,
  args: {
    originDecided: boolean;
    isRootSpan: boolean;
    sdkPresent: boolean;
    /** The event's own business instant — never scheduled from alone, only
     * floored at `ctx.now` so a replayed or backdated event cannot arm a
     * deadline already in the past. */
    occurredAt: number;
  },
  ctx: ProcessContext,
): EvolveStep<OriginGateState, OriginGateIntents> {
  const seen: OriginGateState = {
    ...state,
    sdkSeen: state.sdkSeen || args.sdkPresent,
  };

  if (seen.resolved) return closed(seen);
  if (args.originDecided || (args.isRootSpan && seen.sdkSeen))
    return closed(seen);
  if (!ctx.processKey)
    return {
      state: { ...seen, deadlineAt: null },
      intents: [],
      nextWakeAt: null,
    };
  // Armed once, from the first span that found no origin.
  if (seen.deadlineAt !== null) return unchanged(seen);
  if (ctx.now - args.occurredAt > STALE_TRACE_THRESHOLD_MS)
    return unchanged(seen);

  const deadlineAt =
    Math.max(args.occurredAt, ctx.now) + ORIGIN_GATE_DEADLINE_MS;
  return {
    state: { ...seen, deadlineAt },
    intents: [],
    nextWakeAt: deadlineAt,
  };
}

export const originGateOn: ProcessManagerHandlerMap<
  typeof traceEvents,
  OriginGateState,
  OriginGateIntents
> = {
  spanReceived(state, data, ctx) {
    return evolveGate(
      state,
      {
        originDecided: spanHasOriginEvidence(data),
        isRootSpan: data.parentSpanId === null,
        sdkPresent:
          typeof data.resourceAttributes["telemetry.sdk.name"] === "string",
        occurredAt: data.occurredAt,
      },
      ctx,
    );
  },
  // A log contribution carries no origin evidence of its own — the trace is
  // simply on the clock, same as a plain span.
  logContributed(state, data, ctx) {
    return evolveGate(
      state,
      {
        originDecided: false,
        isRootSpan: false,
        sdkPresent: false,
        occurredAt: data.timeUnixMs,
      },
      ctx,
    );
  },
  originResolved(state) {
    return closed(state);
  },
};

export function originGateOnWake(
  state: OriginGateState,
  ctx: ProcessContext,
): EvolveStep<OriginGateState, OriginGateIntents> {
  if (state.resolved || !ctx.processKey) return closed(state);
  return {
    state: { ...state, resolved: true, deadlineAt: null },
    nextWakeAt: null,
    intents: [
      {
        type: "resolveOrigin",
        payload: { tenantId: ctx.tenantId, traceId: ctx.processKey },
      },
    ],
  };
}
