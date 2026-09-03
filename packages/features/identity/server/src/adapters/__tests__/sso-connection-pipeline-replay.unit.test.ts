/** @vitest-environment node */

import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  CONNECTION_RESUMED_EVENT_TYPE,
  CONNECTION_SUSPENDED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  TEARDOWN_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";
import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
} from "@langwatch/eventing";
import {
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
} from "../../projections/sso-connection-state.projection";
import type { SsoConnectionEvent } from "../sso-connection-pipeline-definition.adapter";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const ACTOR = { type: "user" as const, id: "user_ana" };
const T0 = 1_756_000_000_000;

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [] as string[],
};

let sequence = 0;

function event(type: string, data: Record<string, unknown>, offsetMs: number): SsoConnectionEvent {
  sequence += 1;
  return {
    id: `evt_${String(sequence).padStart(4, "0")}`,
    aggregateId: CONNECTION,
    aggregateType: "sso_connection",
    tenantId: ORG,
    type,
    version: "2026-08-24",
    data: { source: "self-serve", actor: ACTOR, ...data },
    metadata: {},
    occurredAt: T0 + offsetMs,
    createdAt: T0 + offsetMs,
  } as unknown as SsoConnectionEvent;
}

/** A connection's whole life, in log order. */
function lifecycle(): SsoConnectionEvent[] {
  return [
    event(
      CONNECTION_REGISTERED_EVENT_TYPE,
      {
        connectionId: CONNECTION,
        organizationId: ORG,
        type: "oidc",
        idp: IDP,
        allowsJit: true,
      },
      0,
    ),
    event(DOMAIN_CLAIMED_EVENT_TYPE, { connectionId: CONNECTION, domain: "acme.com" }, 1_000),
    event(
      DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
      { connectionId: CONNECTION, domain: "acme.com" },
      2_000,
    ),
    event(
      DOMAIN_VERIFIED_EVENT_TYPE,
      { connectionId: CONNECTION, domain: "acme.com", method: "dns-txt" },
      3_000,
    ),
    event(
      CONNECTION_ACTIVATED_EVENT_TYPE,
      { connectionId: CONNECTION, testLoginAccountId: "acc_test" },
      4_000,
    ),
    event(
      CONNECTION_SUSPENDED_EVENT_TYPE,
      { connectionId: CONNECTION, reason: "IdP maintenance" },
      5_000,
    ),
    event(CONNECTION_RESUMED_EVENT_TYPE, { connectionId: CONNECTION }, 6_000),
    event(
      TEARDOWN_REQUESTED_EVENT_TYPE,
      {
        connectionId: CONNECTION,
        reason: null,
        tearDownAfterMs: T0 + 100_000,
      },
      7_000,
    ),
  ];
}

/**
 * The store the queue's fold writes through, in memory — and the reason this
 * test has one: replay parity is a property of what LANDS, so both legs have
 * to go through a store rather than being compared as loose state.
 */
class InMemoryProjectionStore implements StateProjectionStore<SsoConnectionFoldState> {
  stored: StoredProjection<SsoConnectionFoldState> | null = null;

  async tryLoad(): Promise<StoredProjection<SsoConnectionFoldState> | null> {
    return this.stored;
  }

  async store(
    projection: StoredProjection<SsoConnectionFoldState>,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    this.stored = projection;
  }
}

/**
 * The COLUMNS the Postgres store writes, out of a stored projection.
 *
 * `CreatedAt` / `UpdatedAt` / `LastEventOccurredAt` are the base class's
 * bookkeeping stamps and are deliberately absent: `apply()` derives
 * `UpdatedAt` from `Date.now()`, and no column is written from any of the
 * three — the row's `occurredAt` comes from the projection's own
 * `occurredAt`, and its `createdAt`/`updatedAt` are Postgres-managed. So this
 * IS the whole row, and comparing the stamps would be comparing wall clocks.
 */
function persistedRow(stored: StoredProjection<SsoConnectionFoldState>) {
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

/** One fold pass over a list of events, storing after each — the live path
 *  applies one event at a time, and a rebuild applies the whole log. */
async function fold(
  events: SsoConnectionEvent[],
  perEvent: boolean,
): Promise<StoredProjection<SsoConnectionFoldState>> {
  const store = new InMemoryProjectionStore();
  const projection = new SsoConnectionStateFoldProjection({ store });
  const context = { aggregateId: CONNECTION, tenantId: ORG };
  let state: SsoConnectionFoldState = {
    ...(
      projection as unknown as {
        initState: () => Omit<
          SsoConnectionFoldState,
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

describe("the sso connection projection", () => {
  describe("given a connection with a full lifecycle of events", () => {
    /** @scenario "The projection replays whole-row like every identity projection" */
    it("rebuilds from the event log alone to the identical row", async () => {
      const events = lifecycle();

      const live = await fold(events, true);
      const rebuilt = await fold(events, false);

      expect(persistedRow(rebuilt)).toEqual(persistedRow(live));
      // And the row is the connection's real state, not an empty shell that
      // happens to match another empty shell.
      expect(persistedRow(live)).toMatchObject({
        connectionId: CONNECTION,
        organizationId: ORG,
        state: "TEARDOWN_PENDING",
        verifiedDomains: ["acme.com"],
        testLoginAccountId: "acc_test",
        tearDownAfterMs: T0 + 100_000,
      });
    });

    /** @scenario "The projection replays whole-row like every identity projection" */
    it("rebuilds the same row from a partial replay's starting point", async () => {
      const events = lifecycle();

      // A replay that resumes mid-log must land where a full one does: the
      // fold is a pure function of the events, so folding 5-then-3 and
      // folding 8 are the same row.
      const wholeLog = await fold(events, false);
      const inTwoHalves = await fold(events, true);

      expect(persistedRow(inTwoHalves)).toEqual(persistedRow(wholeLog));
    });
  });
});
