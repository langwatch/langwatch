/**
 * Uses the vanilla tRPC client, not `useMutation` — the request must be
 * abortable, since leaving the workbench mid-query cancels the HTTP call
 * rather than just ignoring the answer. Same seam `spanTreePagedQuery` uses.
 */

import {
  type LangWatchQLQueryResult,
  type LangWatchQLRunTelemetryRequest,
  type LangWatchQLTimeWindow,
  LWQL_ALL_PROJECTS,
  type TraceSource,
} from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

import type { LangWatchQLExecute } from "../model/lwql-request-controller.ts";
import type { LangWatchQLParameterValue } from "../model/lwql-request-state.ts";

export interface LangWatchQLQueryInput {
  projectId: string;
  sql: string;
  parameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  timeWindow?: LangWatchQLTimeWindow;
  sources?: TraceSource[] | null;
  projects?: string[] | typeof LWQL_ALL_PROJECTS;
  telemetry?: LangWatchQLRunTelemetryRequest | undefined;
}

const isoInstant = (epochMs: number): string =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ fractionalSecondDigits: 3 });

export interface LangWatchQLQueryTransport {
  mutate(
    input: LangWatchQLQueryInput,
    options?: { signal?: AbortSignal },
  ): Promise<LangWatchQLQueryResult>;
}

/** What a run sends as `projects`: its own list, else "all" when bound so, else nothing. */
function projectsOf({
  projects,
  readsEveryProject,
}: {
  projects: readonly string[] | undefined;
  readsEveryProject: boolean;
}): Pick<LangWatchQLQueryInput, "projects"> {
  // The wire takes plain arrays, the draft holds read-only ones.
  if (projects !== undefined) return { projects: [...projects] };
  return readsEveryProject ? { projects: LWQL_ALL_PROJECTS } : {};
}

/**
 * Binds an executor to one project, over the app's typed tRPC mutation as a named transport port;
 * the request machine only knows a submission can be aborted. `readsEveryProject`: a run naming
 * no projects reads every project the member may read (ADR-002, D2).
 */
export function createLangWatchQLExecute({
  transport,
  projectId,
  readsEveryProject = false,
}: {
  transport: LangWatchQLQueryTransport;
  projectId: string;
  readsEveryProject?: boolean;
}): LangWatchQLExecute {
  return ({ timeWindow, sources, projects, ...request }, { signal }) =>
    transport.mutate(
      {
        ...request,
        // The wire takes plain arrays, the draft holds read-only ones.
        ...(sources === undefined ? {} : { sources: sources === null ? null : [...sources] }),
        ...projectsOf({ projects, readsEveryProject }),
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
