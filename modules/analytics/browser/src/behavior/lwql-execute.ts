/**
 * Uses the vanilla tRPC client, not `useMutation` — the request must be
 * abortable, since leaving the workbench mid-query cancels the HTTP call
 * rather than just ignoring the answer. Same seam `spanTreePagedQuery` uses.
 */

import type { LangWatchQLQueryResult, LangWatchQLTimeWindow } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

import type { LangWatchQLExecute } from "../model/lwql-request-controller.ts";
import type { LangWatchQLParameterValue } from "../model/lwql-request-state.ts";

export interface LangWatchQLQueryInput {
  projectId: string;
  sql: string;
  parameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  timeWindow?: LangWatchQLTimeWindow;
}

const isoInstant = (epochMs: number): string =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ fractionalSecondDigits: 3 });

export interface LangWatchQLQueryTransport {
  mutate(
    input: LangWatchQLQueryInput,
    options?: { signal?: AbortSignal },
  ): Promise<LangWatchQLQueryResult>;
}

/**
 * Binds an executor to one project: the app supplies the typed tRPC
 * mutation as a named transport port, and the feature request machine
 * only knows that one submission can be aborted.
 */
export function createLangWatchQLExecute({
  transport,
  projectId,
}: {
  transport: LangWatchQLQueryTransport;
  projectId: string;
}): LangWatchQLExecute {
  return ({ timeWindow, ...request }, { signal }) =>
    transport.mutate(
      {
        ...request,
        // ISO instants on the wire, milliseconds in the draft: the draft
        // compares snapshots by value, and the endpoint reads a window.
        ...(timeWindow
          ? {
              timeWindow: {
                start: isoInstant(timeWindow.start),
                end: isoInstant(timeWindow.end),
              },
            }
          : {}),
        // `projectId` goes last so the bound project wins: spreading it first
        // let any `projectId` carried on the request override the project this
        // executor is bound to, which is the one thing the binding prevents.
        projectId,
      },
      { signal },
    );
}
