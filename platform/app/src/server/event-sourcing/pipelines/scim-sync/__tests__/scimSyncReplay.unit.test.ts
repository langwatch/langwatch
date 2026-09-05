/** @vitest-environment node */

/**
 * Replay rebuilds everything the reconciliation views show (ADR-122).
 *
 * Both surfaces render the `ScimSyncState` projection and nothing else that a
 * replay could not re-derive, so replay correctness IS surface correctness
 * here — which is why this proves the two together rather than only the row:
 * the whole persisted row rebuilds identically from the log, AND the view
 * models the org and operator surfaces build out of it are identical too.
 *
 * The `ssoConnectionReplay` shape, with one difference that matters:
 * `createdAtMs` / `updatedAtMs` are EVENT-derived columns on this projection
 * (the Postgres store writes them from the reducer's state, not from a
 * clock), so unlike the connection projection they are load-bearing and are
 * compared rather than stripped. Only the base class's three bookkeeping
 * stamps come out.
 */
import {
  SCIM_APPLY_FAILED_EVENT_TYPE,
  SCIM_APPLY_REDRIVEN_EVENT_TYPE,
  SCIM_APPLY_RETIRED_EVENT_TYPE,
  SCIM_GROUP_MAPPED_EVENT_TYPE,
  SCIM_TOKEN_ISSUED_EVENT_TYPE,
  SCIM_TOKEN_REVOKED_EVENT_TYPE,
  SCIM_USER_PUSHED_EVENT_TYPE,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import { scimSyncStatusCopy } from "~/server/app-layer/identity/scim-reconciliation-copy";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "../../../projections/stateProjection.types";
import {
  type ScimSyncFoldState,
  ScimSyncStateFoldProjection,
} from "../projections/scimSyncState.foldProjection";
import type { ScimSyncEvent } from "../schemas/events";

const ORG = "org_acme";
const CONNECTION = "ssoc_acme_okta";
const OPERATOR = { type: "user" as const, id: "user_ops" };
const DIRECTORY = { type: "system" as const, id: "system:scim" };
const T0 = 1_756_000_000_000;

let sequence = 0;

function event(
  type: string,
  data: Record<string, unknown>,
  offsetMs: number,
): ScimSyncEvent {
  sequence += 1;
  return {
    id: `evt_${String(sequence).padStart(4, "0")}`,
    aggregateId: CONNECTION,
    aggregateType: "scim_sync",
    tenantId: ORG,
    type,
    version: "2026-08-24",
    data: {
      scimSyncId: CONNECTION,
      connectionId: CONNECTION,
      organizationId: ORG,
      ...data,
    },
    metadata: {},
    occurredAt: T0 + offsetMs,
    createdAt: T0 + offsetMs,
  } as unknown as ScimSyncEvent;
}

/**
 * One connection's whole directory-sync life, in log order — every event type
 * the aggregate has, so `deadLetters` accumulates and the re-drive stamps
 * one. REVOKED is absorbing, so it goes last.
 */
function lifecycle(): ScimSyncEvent[] {
  return [
    event(
      SCIM_TOKEN_ISSUED_EVENT_TYPE,
      { tokenId: "scimtok_1", actor: DIRECTORY },
      0,
    ),
    event(
      SCIM_USER_PUSHED_EVENT_TYPE,
      { userId: "user_sam", externalId: "u-1", op: "create" },
      1_000,
    ),
    event(
      SCIM_APPLY_FAILED_EVENT_TYPE,
      {
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        retryable: false,
        userId: "user_sam",
      },
      2_000,
    ),
    event(
      SCIM_APPLY_RETIRED_EVENT_TYPE,
      {
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        attempts: 1,
        userId: "user_sam",
      },
      2_000,
    ),
    event(
      SCIM_APPLY_REDRIVEN_EVENT_TYPE,
      {
        op: "deactivate_user",
        errorCode: "offboard_incomplete",
        userId: "user_sam",
        retiredAtMs: T0 + 2_000,
        actor: OPERATOR,
      },
      3_000,
    ),
    event(
      SCIM_GROUP_MAPPED_EVENT_TYPE,
      { groupId: "group_eng", externalId: "g-1" },
      4_000,
    ),
    event(
      SCIM_TOKEN_REVOKED_EVENT_TYPE,
      { tokenId: "scimtok_1", cause: "teardown" },
      5_000,
    ),
  ];
}

/** The store the queue's fold writes through, in memory: replay parity is a
 *  property of what LANDS, so both legs go through a store. */
class InMemoryProjectionStore
  implements StateProjectionStore<ScimSyncFoldState>
{
  stored: StoredProjection<ScimSyncFoldState> | null = null;

  async load(): Promise<StoredProjection<ScimSyncFoldState> | null> {
    return this.stored;
  }

  async store(
    projection: StoredProjection<ScimSyncFoldState>,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    this.stored = projection;
  }
}

/**
 * The COLUMNS the Postgres store writes. The base class's three bookkeeping
 * stamps come out because `apply()` derives one of them from `Date.now()` and
 * no column is written from any of them; everything else — including
 * `createdAtMs` and `updatedAtMs`, which ARE columns here — stays in.
 */
function persistedRow(stored: StoredProjection<ScimSyncFoldState>) {
  const {
    CreatedAt: _created,
    UpdatedAt: _updated,
    LastEventOccurredAt: _lastOccurred,
    ...columns
  } = stored.state;
  return {
    ...columns,
    occurredAt: stored.occurredAt,
    lastEventId: stored.cursor.eventId,
    acceptedAt: stored.cursor.acceptedAt,
    projectionVersion: stored.version,
  };
}

async function fold(
  events: ScimSyncEvent[],
  perEvent: boolean,
): Promise<StoredProjection<ScimSyncFoldState>> {
  const store = new InMemoryProjectionStore();
  const projection = new ScimSyncStateFoldProjection({ store });
  const context = { aggregateId: CONNECTION, tenantId: ORG };
  let state: ScimSyncFoldState = {
    ...(
      projection as unknown as {
        initState: () => Omit<
          ScimSyncFoldState,
          "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
        >;
      }
    ).initState(),
    CreatedAt: T0,
    UpdatedAt: T0,
    LastEventOccurredAt: 0,
  };
  for (const [index, applied] of events.entries()) {
    state = projection.apply(state, applied);
    const isLast = index === events.length - 1;
    if (!perEvent && !isLast) continue;
    await store.store(
      {
        state,
        cursor: { acceptedAt: applied.createdAt, eventId: applied.id },
        occurredAt: applied.occurredAt,
        createdAt: events[0]!.occurredAt,
        updatedAt: applied.occurredAt,
        version: projection.version,
      },
      context as unknown as ProjectionStoreContext,
    );
  }
  return store.stored!;
}

/**
 * What the two surfaces actually render out of a row: the org view's words,
 * and the operator view's failure detail. Comparing these as well as the row
 * is what makes this a proof about the VIEWS rather than only about a fold.
 */
function viewsOf(stored: StoredProjection<ScimSyncFoldState>) {
  const state = stored.state;
  return {
    organization: {
      status: scimSyncStatusCopy({
        state: state.state,
        hasPushed: state.lastPushedAtMs !== null,
        revokedCause: state.revokedCause,
      }),
      lastPushedAtMs: state.lastPushedAtMs,
      failureCount: state.deadLetters.length,
    },
    operator: {
      state: state.state,
      lastFailure: state.lastFailure,
      deadLetters: state.deadLetters,
    },
  };
}

describe("the directory sync projection", () => {
  describe("given a connection with a full lifecycle of directory events", () => {
    /** @scenario "Replay rebuilds everything the views show" */
    it("rebuilds from the event log alone to the identical row and the identical views", async () => {
      const events = lifecycle();

      const live = await fold(events, true);
      const rebuilt = await fold(events, false);

      expect(persistedRow(rebuilt)).toEqual(persistedRow(live));
      expect(viewsOf(rebuilt)).toEqual(viewsOf(live));

      // And what both legs hold is the connection's real state, not an empty
      // shell that happens to match another empty shell: the sync ended, the
      // dead letter survived the teardown, and the re-drive is stamped on it.
      expect(persistedRow(live)).toMatchObject({
        connectionId: CONNECTION,
        organizationId: ORG,
        state: "REVOKED",
        revokedCause: "teardown",
        lastPushedAtMs: T0 + 4_000,
      });
      expect(live.state.deadLetters).toEqual([
        {
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          attempts: 1,
          retiredAtMs: T0 + 2_000,
          redrivenAtMs: T0 + 3_000,
          userId: "user_sam",
          occurredAtMs: T0 + 2_000,
        },
      ]);
    });

    it("holds the same row after a partial replay resumes as after one pass", async () => {
      const events = lifecycle();
      const whole = await fold(events, false);
      const resumed = await fold(events, true);

      expect(persistedRow(resumed)).toEqual(persistedRow(whole));
    });
  });
});
