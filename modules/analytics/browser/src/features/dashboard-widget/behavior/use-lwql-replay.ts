/**
 * Replays one kept statement over a fixed window through the LangWatchQL door, as the reader.
 * The window and grain reach the statement only as the reserved dashboard-context parameters
 * the door binds (ADR-130); nothing is written into the statement's text.
 */

import {
  LWQL_ACCEPTED_GRANULARITY_STEPS,
  type LangWatchQLAcceptedGranularityStep,
} from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";
import { useEffect, useRef, useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";

export interface UseLwqlReplayInput {
  /** Undefined before a project is in scope: nothing runs. */
  readonly projectId: string | undefined;
  readonly sql: string;
  /** Epoch milliseconds, half-open. */
  readonly start: number;
  readonly end: number;
  readonly granularitySeconds: number;
  readonly parameters?: Readonly<Record<string, string | number | boolean>>;
}

const isoInstant = (epochMs: number): string =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ fractionalSecondDigits: 3 });

/** The kept step when the door offers it; a statement declaring the grain is refused without. */
function acceptedStep(seconds: number): LangWatchQLAcceptedGranularityStep | undefined {
  return LWQL_ACCEPTED_GRANULARITY_STEPS.find((step) => step === seconds);
}

type Replay = Omit<UseLwqlReplayInput, "projectId">;

/** By value: a caller handing an equal parameter map in a new object asks for nothing new. */
function replayKey({ projectId, replay }: { projectId: string; replay: Replay }): string {
  const { start, end, granularitySeconds, parameters, sql } = replay;
  return `${projectId}:${start}:${end}:${granularitySeconds}:${JSON.stringify(parameters ?? {})}:${sql}`;
}

/** What the door is asked: the statement as kept, its values and the window beside it. */
function replayRequest({ projectId, replay }: { projectId: string; replay: Replay }) {
  const step = acceptedStep(replay.granularitySeconds);
  return {
    projectId,
    sql: replay.sql,
    ...(replay.parameters ? { parameters: replay.parameters } : {}),
    timeWindow: { start: isoInstant(replay.start), end: isoInstant(replay.end) },
    ...(step === void 0 ? {} : { granularitySeconds: step }),
  };
}

export function useLwqlReplay({ projectId, ...replay }: UseLwqlReplayInput) {
  const run = analyticsApi.analytics.lwql.query.useMutation();
  const { mutate } = run;

  type RunResult = NonNullable<typeof run.data>;
  type Settled =
    | { readonly key: string; readonly result: RunResult }
    | { readonly key: string; readonly error: unknown };

  const lastRequest = useRef<string | null>(null);
  const [settled, setSettled] = useState<Settled | null>(null);
  const { sql, start, end, granularitySeconds, parameters } = replay;
  const requestKey =
    projectId === void 0
      ? null
      : replayKey({ projectId, replay: { sql, start, end, granularitySeconds, parameters } });

  useEffect(() => {
    if (projectId === void 0 || requestKey === null || lastRequest.current === requestKey) return;
    lastRequest.current = requestKey;

    // Only the answer to the request on screen is kept, so a straggler never replaces it.
    const settle = (outcome: Settled) => {
      if (lastRequest.current === outcome.key) setSettled(outcome);
    };
    mutate(
      replayRequest({ projectId, replay: { sql, start, end, granularitySeconds, parameters } }),
      {
        onSuccess: (result) => settle({ key: requestKey, result }),
        onError: (error) => settle({ key: requestKey, error }),
      },
    );
  }, [projectId, requestKey, mutate, sql, start, end, granularitySeconds, parameters]);

  const current = settled?.key === requestKey ? settled : void 0;
  return {
    result: current && "result" in current ? current.result : void 0,
    error: current && "error" in current ? current.error : void 0,
  };
}
