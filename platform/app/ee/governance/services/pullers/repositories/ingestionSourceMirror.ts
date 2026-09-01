// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { IngestionPullRunStatusData } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/projections/ingestionPullRunStatus.foldProjection";

/**
 * The columns the run-status projection mirrors back onto `IngestionSource`.
 *
 * `undefined` means "leave the column alone" -- Prisma's own semantics. The
 * mirror only ever moves a column forward, so a fold that has nothing new to
 * say about a column omits it rather than writing a null over what the puller
 * or an admin already put there.
 *
 * `pollerCursor` is deliberately a plain `string | null` and not
 * `Prisma.JsonNull`: keeping this builder free of the generated client is
 * what lets the fold's unit tests assert the mirror shape without booting
 * Prisma. The repository does the one-line JSON-null conversion.
 */
export interface IngestionSourceMirror {
  pollerCursor: string | null;
  errorCount: number;
  lastSuccessAt: Date | undefined;
  lastEventAt: Date | undefined;
  status: "active" | undefined;
}

export function buildIngestionSourceMirror({
  state,
}: {
  state: IngestionPullRunStatusData;
}): IngestionSourceMirror {
  const deliveredEvents =
    state.Enabled &&
    state.LastRunOutcome === "completed" &&
    state.LastRunEventCount > 0;

  return {
    pollerCursor: state.Cursor,
    errorCount: state.ConsecutiveErrors,
    // A run that reached the provider and found nothing new still succeeded,
    // so this advances on every CLEAN completion -- the fold leaves it where
    // it was when the run also reported errors. `lastEventAt` below does not
    // advance either way: it answers "when did data last arrive", which an
    // empty run does not move. Conflating the two is what made a dead puller
    // read as a quiet one (ADR-128).
    lastSuccessAt:
      state.LastSuccessAt === null ? undefined : new Date(state.LastSuccessAt),
    lastEventAt:
      deliveredEvents && state.LastRunAt !== null
        ? new Date(state.LastRunAt)
        : undefined,
    status: deliveredEvents ? "active" : undefined,
  };
}
