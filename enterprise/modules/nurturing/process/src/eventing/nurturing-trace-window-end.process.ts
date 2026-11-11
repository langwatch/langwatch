// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hourly sweep that ends organizations' trace windows: an organization that stops tracing
 * syncs no more, so only a schedule can tell Customer.io its rolling trace traits ended.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const TRACE_WINDOW_END_PROCESS_NAME = "nurturingTraceWindowEnd";

/** Hourly: a window's end reaches Customer.io within the hour. */
export const TRACE_WINDOW_END_INTERVAL_MS = 60 * 60 * 1000;

/** Outbox rows are bookkeeping, one per sweep, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** The span of window ends one sweep covers, (`after`, `upTo`], epoch ms. */
export const traceWindowEndSweepSchema = z.object({
  after: z.number().int(),
  upTo: z.number().int(),
});

export const traceWindowEndStateSchema = z.object({ lastSweepAt: z.number().nullable() });
type TraceWindowEndState = z.infer<typeof traceWindowEndStateSchema>;

type TraceWindowEndIntents = { sweep: IntentSpec<typeof traceWindowEndSweepSchema> };

/**
 * Each wake sweeps from the last wake's slot, so a missed or late wake leaves no gap and each
 * window's end falls in one sweep; the first sweeps one interval back.
 */
export const traceWindowEndWake: WakeHandler<TraceWindowEndState, TraceWindowEndIntents> = (
  state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [
    ctx.intent("sweep", `sweep:${ctx.at}`, {
      after: state.lastSweepAt ?? ctx.at - TRACE_WINDOW_END_INTERVAL_MS,
      upTo: ctx.at,
    }),
  ],
});

export interface TraceWindowEndRunDeps {
  readonly traceWindowsEnded: (input: Readonly<{ after: number; upTo: number }>) => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** A failed sweep throws, so the outbox retries it; the prune is bookkeeping and may wait. */
export function runTraceWindowEnd(
  deps: TraceWindowEndRunDeps,
): (sweep: z.output<typeof traceWindowEndSweepSchema>) => Promise<void> {
  return async (sweep) => {
    const startedAt = deps.now();
    await deps.traceWindowsEnded(sweep);
    await deps
      .deleteDispatchedBefore({
        processName: TRACE_WINDOW_END_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
