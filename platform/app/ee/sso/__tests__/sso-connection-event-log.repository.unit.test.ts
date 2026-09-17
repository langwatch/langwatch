/**
 * @vitest-environment node
 *
 * The SSO connection log, read: newest first, and scoped to whichever
 * tenant the caller actually asked for.
 *
 * Corresponds to specs/identity/sso-connection-history.feature.
 */

import type { SsoConnectionEvent } from "@ee/event-sourcing/pipelines/sso-connections/schemas/events";
import { describe, expect, it } from "vitest";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { EventLogSsoConnectionHistoryRepository } from "../sso-connection-event-log.repository";

const ACME = "org_acme";
const CONNECTION = "ssoc_acme";
const T0 = 1_700_000_000_000;

function event({
  id,
  type,
  occurredAt,
  data,
}: {
  id: string;
  type: string;
  occurredAt: number;
  data: Record<string, unknown>;
}): SsoConnectionEvent {
  return {
    id,
    type,
    occurredAt,
    aggregateId: CONNECTION,
    data,
  } as unknown as SsoConnectionEvent;
}

/** A store that hands back whatever this tenant's own events are, and
 *  records the tenant it was asked for — so a test can prove the repository
 *  never widens the scan past what it was given. */
function repositoryOver(eventsByTenant: Record<string, SsoConnectionEvent[]>): {
  repo: EventLogSsoConnectionHistoryRepository;
  requestedTenants: string[];
} {
  const requestedTenants: string[] = [];
  const store = {
    // A real store filters by BOTH the tenant and the aggregate id; this
    // fake does the same, or a query for a connection id that belongs to
    // nobody in this tenant would "find" another connection's events purely
    // because they share a bucket — which is exactly the leak this
    // repository's tenancy claim promises cannot happen.
    getEvents: async (aggregateId: string, context: { tenantId: string }) => {
      requestedTenants.push(context.tenantId);
      return (eventsByTenant[context.tenantId] ?? []).filter(
        (event) => event.aggregateId === aggregateId,
      );
    },
  } as unknown as EventStore<SsoConnectionEvent>;
  return {
    repo: new EventLogSsoConnectionHistoryRepository({
      eventStore: async () => store,
    }),
    requestedTenants,
  };
}

describe("given a connection with a history of facts", () => {
  const events = [
    event({
      id: "evt_1",
      type: "lw.identity.connection_registered",
      occurredAt: T0,
      data: { source: "self-serve" },
    }),
    event({
      id: "evt_3",
      type: "lw.identity.connection_activated",
      occurredAt: T0 + 2000,
      data: { source: "self-serve" },
    }),
    event({
      id: "evt_2",
      type: "lw.identity.domain_claimed",
      occurredAt: T0 + 1000,
      data: { domain: "acme.com", source: "self-serve" },
    }),
  ];

  describe("when the history is read", () => {
    /** @scenario "What happened is listed newest first" */
    it("lists the facts newest first, each with when it happened", async () => {
      const { repo } = repositoryOver({ [ACME]: events });

      const history = await repo.findHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 10,
      });

      expect(history.map((entry) => entry.eventId)).toEqual([
        "evt_3",
        "evt_2",
        "evt_1",
      ]);
      expect(history[0]).toMatchObject({
        type: "lw.identity.connection_activated",
        occurredAtMs: T0 + 2000,
      });
    });

    it("carries structural fields only, never a raw payload", async () => {
      const { repo } = repositoryOver({ [ACME]: events });

      const history = await repo.findHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 10,
      });

      for (const entry of history) {
        expect(Object.keys(entry).sort()).toEqual(
          [
            "domain",
            "eventId",
            "method",
            // The connection's own display name, carried by the rename fact.
            // Structural in the sense this test means: a label the customer
            // chose and reads on the card above this panel, not a scrap of
            // the raw event payload.
            "name",
            "note",
            "occurredAtMs",
            "policy",
            "replacesConnectionId",
            "route",
            "source",
            "type",
          ].sort(),
        );
      }
    });
  });

  describe("when another organization's connection is asked for", () => {
    /** @scenario "Another organization's connection history is not there to read" */
    it("reads only events appended under the caller's own tenant", async () => {
      const { repo, requestedTenants } = repositoryOver({
        [ACME]: events,
        org_globex: [
          event({
            id: "evt_globex",
            type: "lw.identity.connection_registered",
            occurredAt: T0,
            data: { source: "self-serve" },
          }),
        ],
      });

      const history = await repo.findHistory({
        organizationId: ACME,
        connectionId: "ssoc_globex",
        limit: 10,
      });

      // The tenant actually asked for is the caller's own — never widened
      // to scan for the connection across every tenant.
      expect(requestedTenants).toEqual([ACME]);
      // And under that tenant, a connection id that belongs to nobody finds
      // nothing — the same answer a connection that does not exist gets.
      expect(history).toEqual([]);
    });
  });
});
