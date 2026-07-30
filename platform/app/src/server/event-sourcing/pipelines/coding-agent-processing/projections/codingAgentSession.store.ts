import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { defineFoldStore } from "../../../projections/foldStore/defineFoldStore";
import { foldCodec } from "../../../projections/foldStore/foldCodec";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
  CODING_AGENT_SESSION_PROJECTION_VERSION_WITHDRAWN,
  type CodingAgentSessionRow,
  type CodingAgentSessionState,
  codingAgentSessionStateFromRow,
  projectCodingAgentSessionToRow,
} from "./codingAgentSession.foldProjection";

/**
 * The fold store for the coding-agent session fold (ADR-056, read-back per
 * ADR-066).
 *
 * This fold has the most complicated history of any read-back store, and it is
 * the one the shared library had to absorb without a bespoke gate. Its ladder
 * below carries all three of the awkward facts, as data:
 *
 * - migrations 00053/00054 shipped read-back columns WITHOUT moving the stamp,
 *   so ONE stamp spans two row shapes and only the row can say which it is;
 * - the 2026-07-28 bump withdrew the stamp beneath it for recording the wrong
 *   counts, so the readable shapes are NOT a contiguous run;
 * - everything older than all of that is a shape this fold has never reasoned
 *   about.
 *
 * There is no session-level "is this a coding agent" gate: the dispatchers on
 * the source pipelines are the gate, so every folded state is a session worth a
 * row — including a metric-only session with zero model calls and zero tool
 * runs (specs/coding-agent/session-aggregate.feature). Hence no `signal`.
 */
export const codingAgentSessionFoldStore = defineFoldStore<
  CodingAgentSessionState,
  CodingAgentSessionRow,
  CodingAgentSessionRepository
>({
  name: "coding_agent_sessions",
  retention: "traces",

  read: (repository, { tenantId, aggregateId, window }) =>
    repository.findBySessionIdWithApplied({
      tenantId,
      sessionId: aggregateId,
      window,
    }),

  codec: foldCodec<CodingAgentSessionState, CodingAgentSessionRow>({
    generations: [
      {
        stamp: CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
        /**
         * The stamp that spans the column change, and the evidence that settles
         * it. `LastEventOccurredAt` arrived in migration 00053, `init()`s to 0,
         * and is only ever `max(prev, occurredAt)` where the contribution
         * schemas declare `occurredAt` a POSITIVE integer — so it is strictly
         * positive on every row written by a build that had the column, and
         * exactly 0 on every row that predates it (the column's `DEFAULT 0`).
         *
         * The failure direction is safe: a session whose events were somehow all
         * unhandled reads 0 and is simply rebuilt.
         *
         * This depends on the checkpoint being decoded as UTC — see
         * `CodingAgentSessionClickHouseRepository`, which parses ClickHouse's
         * zone-less DateTime64 through `parseClickHouseDateTimeMs`. Read as
         * local time, a pre-00053 row's `1970-01-01 00:00:00.000` is positive
         * anywhere west of UTC and this would admit exactly the rows it exists
         * to refuse.
         *
         * Kept readable after the 2026-07-28 bump deliberately: these rows
         * predate the logs-only fold entirely, so no agent folded a turn from
         * both a log and a span into them. They are stale in shape, never
         * double-counted, and this evidence already covers the shape. Refusing
         * them would also buy nothing — they predate Cowork detection, so their
         * stored contributions are labelled `claude_code` and a rebuild replays
         * exactly that.
         */
        provenBy: (row) => row.lastEventOccurredAt > 0,
      },
      {
        stamp: CODING_AGENT_SESSION_PROJECTION_VERSION_WITHDRAWN,
        withdrawn:
          "folded by the one-sided logs-only gate, so a session exporting both logs and spans counted every turn twice",
      },
      { stamp: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST },
    ],

    /**
     * The floor sits at the OLDEST generation, not the newest: the pre-stamp
     * rows that carry their evidence are read back rather than rebuilt, which is
     * what keeps a large live population off a full-history rebuild — the exact
     * cost ADR-066 exists to remove, on the aggregate class behind the
     * 2026-07-23 outage. The withdrawn shape above the floor is refused on its
     * own terms.
     */
    readBackSince: 1,

    /**
     * What `decode` reads back beyond the row's own reporting columns. On a row
     * that predates them each decodes as a ClickHouse default indistinguishable
     * from a real value: an empty `MetricSeries` makes the next metric
     * contribution recompute lines/commits/PRs/edit-decisions/active-time from
     * that one series alone, an empty `SubAgentIds` makes the next sub-agent
     * span reset `subAgents` to 1, an empty `StepStartedAt` starts every decoded
     * step at 0 so later steps can only be appended in arrival order, and a
     * zeroed `PreviousCallContextTokens` reads as "first call ever" so the next
     * model call's cache rebuild is never detected.
     */
    reads: [
      "SubAgentIds",
      "StepStartedAt",
      "MetricSeries",
      "PreviousCallContextTokens",
      "LastEventOccurredAt",
      "AppliedEventIds",
    ],

    project: (state, { tenantId, aggregateId, version }) =>
      projectCodingAgentSessionToRow({
        state,
        tenantId,
        sessionId: aggregateId,
        version,
      }),

    decode: codingAgentSessionStateFromRow,
  }),
});

/**
 * The durable tier, for the composition site that still assembles its cache by
 * hand. `codingAgentSessionFoldStore.cached({ repository, cache })` is the shape
 * to use once that site moves.
 */
export const CodingAgentSessionStore = codingAgentSessionFoldStore.Store;
export type CodingAgentSessionStore = InstanceType<
  typeof CodingAgentSessionStore
>;
