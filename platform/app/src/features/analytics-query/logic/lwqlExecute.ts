/**
 * How a submission reaches the LangWatchQL endpoint.
 *
 * The vanilla tRPC client rather than `useMutation`, for one reason: the
 * request has to be abortable. Leaving the workbench mid-query must cancel the
 * HTTP request, not merely ignore its answer, and the mutation hook exposes no
 * signal. This is the same seam and the same unwrapping `spanTreePagedQuery`
 * uses for the span tree.
 *
 * @see ~/features/traces-v2/hooks/spanTreePagedQuery — the pattern this follows
 */

import type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";

import type {
  LangWatchQLExecute,
  LangWatchQLParameterValue,
} from "@langwatch/analytics-web";

export interface LangWatchQLQueryInput {
  projectId: string;
  sql: string;
  parameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  timeWindow?: { start: Date; end: Date };
}

export interface LangWatchQLQueryTransport {
  mutate(
    input: LangWatchQLQueryInput,
    options?: { signal?: AbortSignal },
  ): Promise<LangWatchQLQueryResult>;
}

/**
 * Binds an executor to one project.
 *
 * The app supplies the typed tRPC mutation as a named transport port. The
 * feature request machine only knows that one submission can be aborted.
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
        // Instants on the wire, milliseconds in the draft: the draft compares
        // snapshots by value, and the endpoint reads a window. Converting here
        // keeps each side holding the shape it needs rather than the other's.
        ...(timeWindow
          ? {
              timeWindow: {
                start: new Date(timeWindow.start),
                end: new Date(timeWindow.end),
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
