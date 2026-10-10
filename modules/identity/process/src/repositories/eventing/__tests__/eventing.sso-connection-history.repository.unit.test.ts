/**
 * @vitest-environment node
 * The SSO connection log, read: newest first, scoped to the caller's tenant.
 * Corresponds to specs/identity/sso-connection-history.feature.
 */
import {
  createTenantId,
  EventLogReadSeat,
  type EventReadSeat,
  EventStoreProducerOnly,
  eventToRecord,
  PipelineEventStore,
} from "@langwatch/eventing";
import { EventRepositoryMemory } from "@langwatch/eventing/testing";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
  SSO_CONNECTION_EVENT_VERSION_LATEST,
  SSO_CONNECTION_PIPELINE_NAME,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoConnectionEvent } from "../../../features/sso-connection/eventing/sso-connection-state.projection.ts";
import { EventingSsoConnectionHistoryRepository } from "../../../features/sso-connection/repositories/eventing/eventing.sso-connection-history.repository.ts";

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
  // A real seat filters by BOTH the tenant and the aggregate id; so does
  // this one, or a connection id belonging to nobody in this tenant would
  // "find" another connection's events purely by sharing a bucket.
  const getEvents: EventReadSeat["getEvents"] = async ({ tenantId, aggregateId }) => {
    requestedTenants.push(tenantId);
    return (eventsByTenant[tenantId] ?? []).filter((event) => event.aggregateId === aggregateId);
  };
  return {
    repository: EventingSsoConnectionHistoryRepository.create({
      eventReadSeat: { getEvents },
    }),
    requestedTenants,
  };
}

const API_PROCESS = "langwatch-api";

function isAnyEvent(_event: unknown): _event is unknown {
  return true;
}

/** What the api composes: a store refusing every read, and a read seat over the same log. */
async function apiProcessOver(events: SsoConnectionEvent[]) {
  const log = EventRepositoryMemory.createForTesting();
  await log.insertEventRecords(events.map((event) => eventToRecord(event)));
  const refusingStore = EventStoreProducerOnly.create({ processName: API_PROCESS });
  const ownStore = PipelineEventStore.create({
    pipeline: SSO_CONNECTION_PIPELINE_NAME,
    log: () => refusingStore,
  });
  ownStore.bindTo({ aggregate: { type: SSO_CONNECTION_AGGREGATE_TYPE } });
  return {
    ownStore,
    repository: EventingSsoConnectionHistoryRepository.create({
      eventReadSeat: EventLogReadSeat.create({ repository: log }),
    }),
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
            // The issuer an identity provider update sets: the public address
            // the provider identifies itself by, shown on the same card.
            "issuer",
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

  describe("when it is read in a process that only sends commands", () => {
    /** @scenario "The connection history is readable from a process that only sends commands" */
    it("lists the facts newest first while the process's own store refuses the read", async () => {
      const { repository, ownStore } = await apiProcessOver(events);

      const history = await repository.findHistory({
        organizationId: ACME,
        connectionId: CONNECTION,
        limit: 10,
      });

      expect(history.map((entry) => entry.eventId)).toEqual(["evt_3", "evt_2", "evt_1"]);
      expect(history[1]).toMatchObject({ domain: "acme.com", occurredAtMs: T0 + 1000 });
      await expect(
        ownStore.read({ tenantId: ACME, aggregateId: CONNECTION, accepts: isAnyEvent }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { processName: API_PROCESS, operation: "getEvents" },
      });
    });

    it("finds nothing for a connection named under another organization's tenant", async () => {
      const { repository } = await apiProcessOver(events);

      const history = await repository.findHistory({
        organizationId: "org_globex",
        connectionId: CONNECTION,
        limit: 10,
      });

      expect(history).toEqual([]);
    });
  });
});
