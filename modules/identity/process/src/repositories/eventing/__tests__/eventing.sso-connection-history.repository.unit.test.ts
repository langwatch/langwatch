/**
 * @vitest-environment node
 * The SSO connection log, read: newest first, scoped to the caller's tenant.
 * Corresponds to specs/identity/sso-connection-history.feature.
 */
import { type EventStore, createTenantId } from "@langwatch/eventing";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_EVENT_VERSION_LATEST,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoConnectionEvent } from "../../../eventing/sso-connection-state.projection.ts";
import { EventingSsoConnectionHistoryRepository } from "../eventing.sso-connection-history.repository.ts";

const ACME = "org_acme";
const CONNECTION = "ssoc_acme";
const T0 = 1_700_000_000_000;
const SYSTEM_ACTOR = { type: "system", id: null } as const;

type FactEnvelope = { id: string; occurredAt: number; tenantId: string };

function envelope({ id, occurredAt, tenantId }: FactEnvelope) {
  return {
    id,
    aggregateId: CONNECTION,
    aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
    tenantId: createTenantId(tenantId),
    createdAt: occurredAt,
    occurredAt,
    version: SSO_CONNECTION_EVENT_VERSION_LATEST,
  };
}

function registered(at: FactEnvelope): SsoConnectionEvent {
  return {
    ...envelope(at),
    type: CONNECTION_REGISTERED_EVENT_TYPE,
    data: {
      connectionId: CONNECTION,
      organizationId: ACME,
      type: "oidc",
      idp: { issuer: null, providerId: "okta", clientIdRef: null, secretRef: null, certRefs: [] },
      arrivalPolicy: "refuse",
      actor: SYSTEM_ACTOR,
      source: "self-serve",
    },
  };
}

function activated(at: FactEnvelope): SsoConnectionEvent {
  return {
    ...envelope(at),
    type: CONNECTION_ACTIVATED_EVENT_TYPE,
    data: {
      connectionId: CONNECTION,
      testLoginAccountId: null,
      actor: SYSTEM_ACTOR,
      source: "self-serve",
    },
  };
}

function claimed(at: FactEnvelope): SsoConnectionEvent {
  return {
    ...envelope(at),
    type: DOMAIN_CLAIMED_EVENT_TYPE,
    data: {
      connectionId: CONNECTION,
      domain: "acme.com",
      actor: SYSTEM_ACTOR,
      source: "self-serve",
    },
  };
}

/**
 * A store that hands back this tenant's own events and records the tenant it
 * was asked for, so a test can prove the repository never widens the scan.
 */
function repositoryOver(eventsByTenant: Record<string, SsoConnectionEvent[]>): {
  repository: EventingSsoConnectionHistoryRepository;
  requestedTenants: string[];
} {
  const requestedTenants: string[] = [];
  // A real store filters by BOTH the tenant and the aggregate id; so does
  // this one, or a connection id belonging to nobody in this tenant would
  // "find" another connection's events purely by sharing a bucket.
  const getEvents: EventStore<SsoConnectionEvent>["getEvents"] = async (aggregateId, context) => {
    requestedTenants.push(context.tenantId);
    return (eventsByTenant[context.tenantId] ?? []).filter(
      (event) => event.aggregateId === aggregateId,
    );
  };
  return {
    repository: EventingSsoConnectionHistoryRepository.create({
      eventStore: async () => ({ getEvents }),
    }),
    requestedTenants,
  };
}

describe("given a connection with a history of facts", () => {
  const events = [
    registered({ id: "evt_1", occurredAt: T0, tenantId: ACME }),
    activated({ id: "evt_3", occurredAt: T0 + 2000, tenantId: ACME }),
    claimed({ id: "evt_2", occurredAt: T0 + 1000, tenantId: ACME }),
  ];

  describe("when the history is read", () => {
    /** @scenario "What happened is listed newest first" */
    it("lists the facts newest first, each with when it happened", async () => {
      const { repository } = repositoryOver({ [ACME]: events });

      const history = await repository.findHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 10,
      });

      expect(history.map((entry) => entry.eventId)).toEqual(["evt_3", "evt_2", "evt_1"]);
      expect(history[0]).toMatchObject({
        type: "lw.identity.connection_activated",
        occurredAtMs: T0 + 2000,
      });
      expect(history[1]?.domain).toBe("acme.com");
    });

    it("carries structural fields only, never a raw payload", async () => {
      const { repository } = repositoryOver({ [ACME]: events });

      const history = await repository.findHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 10,
      });

      for (const entry of history) {
        expect(Object.keys(entry).toSorted()).toEqual(
          [
            "domain",
            "eventId",
            "method",
            "name",
            "note",
            "occurredAtMs",
            "policy",
            "replacesConnectionId",
            "route",
            "source",
            "type",
          ].toSorted(),
        );
      }
    });
  });

  describe("when another organization's connection is asked for", () => {
    /** @scenario "Another organization's connection history is not there to read" */
    it("reads only events appended under the caller's own tenant", async () => {
      const { repository, requestedTenants } = repositoryOver({
        [ACME]: events,
        org_globex: [registered({ id: "evt_globex", occurredAt: T0, tenantId: "org_globex" })],
      });

      const history = await repository.findHistory({
        organizationId: ACME,
        connectionId: "ssoc_globex",
        limit: 10,
      });

      // The tenant asked for is the caller's own, never widened to scan for
      // the connection across every tenant.
      expect(requestedTenants).toEqual([ACME]);
      expect(history).toEqual([]);
    });
  });
});
