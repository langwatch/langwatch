// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const GOVERNANCE_TRACE_FACTS_PROCESS_NAME = "governanceTraceFacts";

/** Main's subscriber wrote within its 30 s window; a pass a minute keeps the lag near that. */
export const GOVERNANCE_TRACE_FACTS_INTERVAL_MS = 60 * 1000;

/**
 * A summary's UpdatedAt is the worker's clock when its fold ran; the row lands by async insert
 * (flushed within about a second) and client retries, on another host's clock. Five minutes
 * covers that lag with wide margin; rows replace by key, so re-reading them is harmless.
 */
export const GOVERNANCE_TRACE_FACTS_OVERLAP_MS = 5 * 60 * 1000;

/** The first pass after a deploy covers the hour before it; main's subscriber wrote the rest. */
export const GOVERNANCE_TRACE_FACTS_FIRST_LOOKBACK_MS = 60 * 60 * 1000;

export const governanceTraceFactsPassSchema = z.object({
  fromMs: z.number().int(),
  toMs: z.number().int(),
});

export const governanceTraceFactsStateSchema = z.object({
  /** The schedule time of the last wake that asked for a pass; never a read's result. */
  lastPassAt: z.number().nullable(),
});
type GovernanceTraceFactsState = z.infer<typeof governanceTraceFactsStateSchema>;

export const GOVERNANCE_TRACE_FACTS_INITIAL_STATE: GovernanceTraceFactsState = { lastPassAt: null };

type GovernanceTraceFactsIntents = {
  pass: IntentSpec<typeof governanceTraceFactsPassSchema>;
};

/** Every wake asks for the window [lastPassAt - overlap, at] on the updated axis. Pure. */
export const governanceTraceFactsWake: WakeHandler<
  GovernanceTraceFactsState,
  GovernanceTraceFactsIntents
> = (state, ctx) => {
  const from =
    (state.lastPassAt ?? ctx.at - GOVERNANCE_TRACE_FACTS_FIRST_LOOKBACK_MS) -
    GOVERNANCE_TRACE_FACTS_OVERLAP_MS;
  return {
    state: { lastPassAt: ctx.at },
    intents: [ctx.intent("pass", `pass:${ctx.at}`, { fromMs: from, toMs: ctx.at })],
  };
};
