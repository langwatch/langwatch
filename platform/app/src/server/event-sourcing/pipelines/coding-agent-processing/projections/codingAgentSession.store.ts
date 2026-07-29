import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import { retentionDaysFrom } from "../../shared/analyticsStoreBase";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
  type CodingAgentSessionRow,
  type CodingAgentSessionState,
  codingAgentSessionStateFromRow,
  projectCodingAgentSessionToRow,
} from "./codingAgentSession.foldProjection";

/**
 * Whether a committed row's read-back columns can be trusted.
 *
 * See `CodingAgentSessionStore.getWithApplied` for why the projection version is
 * not sufficient on its own, and why `lastEventOccurredAt` is a sound second
 * half of the discriminator.
 */
function carriesReadBackColumns(row: CodingAgentSessionRow): boolean {
  if (row.version === CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST) {
    return true;
  }
  return (
    row.version === CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP &&
    row.lastEventOccurredAt > 0
  );
}

/**
 * FoldProjectionStore adapter for the coding-agent session fold (ADR-056).
 *
 * Unlike PR #5708's trace-keyed store there is no "is this a coding agent"
 * gate here: the dispatchers on the source pipelines are the gate, so every
 * event this fold sees is a coding-agent contribution and every folded state
 * is a session worth a row — including a metric-only session, which has zero
 * model calls and zero tool runs and must still appear
 * (specs/coding-agent/session-aggregate.feature).
 *
 * Read-back (ADR-066): `get`/`getWithApplied` decode the last committed row
 * (typed read-back columns, migrations 00053/00054) so the delivery path does
 * not refold from `event_log`; the applied-event-id watermark rides next to the
 * row so a cold-cache retry still dedups a redelivered batch. Decoding is gated
 * on whether the row actually carries those columns — see `getWithApplied`.
 */
export class CodingAgentSessionStore
  implements FoldProjectionStore<CodingAgentSessionState>
{
  /**
   * Keys the fold cache, so a version bump misses rather than serving state in
   * the old shape past `getWithApplied`'s gate.
   */
  readonly projectionVersion = CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST;

  constructor(private readonly repo: CodingAgentSessionRepository) {}

  async store(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const entry = this.toRow(state, context);
    await this.repo.upsert(
      entry.row,
      entry.retentionDays,
      entry.appliedEventIds,
    );
  }

  async storeBatch(
    entries: Array<{
      state: CodingAgentSessionState;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const rows = entries.map(({ state, context }) =>
      this.toRow(state, context),
    );
    if (rows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(rows);
      return;
    }
    await Promise.all(
      rows.map(({ row, retentionDays, appliedEventIds }) =>
        this.repo.upsert(row, retentionDays, appliedEventIds),
      ),
    );
  }

  private toRow(
    state: CodingAgentSessionState,
    context: ProjectionStoreContext,
  ): {
    row: ReturnType<typeof projectCodingAgentSessionToRow>;
    retentionDays: number;
    appliedEventIds: string[];
  } {
    return {
      row: projectCodingAgentSessionToRow({
        state,
        tenantId: String(context.tenantId),
        sessionId: String(context.aggregateId),
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      }),
      retentionDays: retentionDaysFrom(context, "traces"),
      // The executor's redelivery-dedup watermark, persisted next to the row so
      // a retry with a cold cache still recognises a batch it committed.
      appliedEventIds: context.appliedEventIds
        ? [...context.appliedEventIds]
        : [],
    };
  }

  /**
   * Read the session's last committed state back together with the
   * applied-event-id watermark persisted next to it (ADR-066) — the
   * CH-fallthrough side of the read path: `CachedFoldStore` serves the warm
   * cache and only calls this on a miss. The row round-trips the full working
   * state — counters, ordered steps (with their start times), the sub-agent
   * dedup set, the previous-call context size, and the converged metric units —
   * plus the watermark, so a retry that reaches a cold cache can still recognise
   * a batch it already committed. It never replays `event_log`; that is the
   * offline rebuild path, not this one.
   *
   * Those columns are only trustworthy on a row written after migration 00053
   * applied. On an older row every one of them decodes as a ClickHouse default
   * indistinguishable from a real value — an empty `MetricSeries` makes the next
   * metric contribution recompute lines/commits/PRs/edit-decisions/active-time
   * from that one series alone and collapse everything already converged, an
   * empty `SubAgentIds` makes the next sub-agent span reset `subAgents` to 1, an
   * empty `StepStartedAt` starts every decoded step at 0 so later steps can only
   * be appended in arrival order, and a zeroed `PreviousCallContextTokens` reads
   * as "first call ever" so the next model call's cache rebuild is never
   * detected. Such a row is reported as a MISS (null state, empty watermark —
   * the same answer as "no row"), which the fold's `refoldOnStoreMiss` rebuilds
   * from `event_log` once; the rewrite carries the current version and every
   * later read hits. Transitional by construction: it stops firing as soon as
   * the session is rewritten, and for the population as a whole once retention
   * has aged the pre-00053 rows out.
   *
   * The DISCRIMINATOR is not the version alone. Migrations 00053 and 00054
   * shipped their read-back columns WITHOUT bumping the stamp, so
   * `2026-07-21` spans both sides of the change: rows written since those
   * deployed carry it with every read-back column fully populated, and rejecting
   * them would refold a large, live population from full `event_log` history for
   * nothing — a regression against the behaviour this store replaces, on the
   * very aggregate class behind the 2026-07-23 outage.
   *
   * `LastEventOccurredAt` separates the two halves by construction rather than
   * by observation. It arrived in 00053, `init()`s to 0
   * (`AbstractFoldProjection.init`), and is only ever `max(prev, occurredAt)`
   * where the contribution schemas declare `occurredAt` a POSITIVE integer
   * (`coding-agent-processing/schemas/contributions.ts`). So it is strictly
   * positive on every row written by a build that had the column, and exactly 0
   * on every row that predates it (the column's `DEFAULT 0`). A row is therefore
   * decodable when it carries the current stamp, or the pre-bump stamp together
   * with a non-zero checkpoint. The failure direction is safe: a session whose
   * events were somehow all unhandled would read 0 and simply refold.
   *
   * That reasoning depends on the checkpoint being decoded as UTC — see
   * `CodingAgentSessionClickHouseRepository`, which parses ClickHouse's
   * zone-less DateTime64 through `parseClickHouseDateTimeMs`. Read as local
   * time, a pre-00053 row's `1970-01-01 00:00:00.000` is positive anywhere west
   * of UTC and the gate would accept exactly the rows it exists to reject.
   *
   * `context.readWindow` — computed by the executor from the fold's declared
   * `options.readWindow` — prunes the read to a window of partitions around the
   * event being folded; it is passed through verbatim. On an ABSENT windowed
   * miss the EXECUTOR retries without the window, so a row outside it is still
   * found; this store neither widens the window nor implements a fallback
   * itself. A row that was FOUND and refused by the version gate is reported as
   * `miss: "undecodable"`, and the executor deliberately does not retry it — a
   * wider scope only finds the same row and refuses it again, so the retry was
   * an unpruned scan per event per stale aggregate that could never succeed.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: CodingAgentSessionState | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const found = await this.repo.findBySessionIdWithApplied({
      tenantId: String(context.tenantId),
      sessionId: aggregateId,
      window: context.readWindow,
    });
    if (!found) return { state: null, appliedEventIds: [], miss: "absent" };
    // Stale schema snapshot: the read-back columns did not exist when this row
    // was written, so decoding it would fabricate state. Answer as for "no row"
    // — the watermark is dropped too, because a watermark without the state it
    // belongs to would suppress the very events the re-fold needs — but report
    // it as `undecodable`, not `absent`: the row was FOUND and refused, so the
    // executor must not answer with an unwindowed re-read that can only find
    // the same row again.
    if (!carriesReadBackColumns(found.row)) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: codingAgentSessionStateFromRow(found.row),
      appliedEventIds: found.appliedEventIds,
    };
  }

  /** State only; delegates to `getWithApplied` so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<CodingAgentSessionState | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }
}
