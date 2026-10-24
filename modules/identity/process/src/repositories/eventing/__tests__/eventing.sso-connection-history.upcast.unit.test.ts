/**
 * @vitest-environment node
 * A version 1 registration in the log, read through the runtime's read seat (with identity's
 * connection pipeline registered) into the SSO connection history.
 * Spec: modules/identity/specs/identity-pipeline-registration-ownership.feature
 */
import { createTenantId, EventLogReadSeat, EventSourcing } from "@langwatch/eventing";
import {
  EventRepositoryMemory,
  EventStoreMemory,
  InMemoryProcessStore,
} from "@langwatch/eventing/testing";
import {
  CONNECTION_REGISTERED_EVENT_TYPE,
  SSO_CONNECTION_AGGREGATE_TYPE,
} from "@langwatch/identity-contract";
import { CONNECTION_REGISTERED_V1_EVENT_TYPE } from "@langwatch/identity-contract/sso-connection-registration-v1";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import {
  licensingFixture,
  StubBreakGlassBindings,
  StubPlatformOperators,
} from "../../../__tests__/support/in-memory-connections.ts";
import { liveRepositories } from "../../../__tests__/support/live-repositories.ts";
import { ConnectedIdentityEventing } from "../../../eventing/identity-command-senders.store.ts";
import { composeSsoConnectionGraph } from "../../../features/sso-connection/eventing/sso-connection.pipeline.ts";
import { EventingSsoConnectionHistoryRepository } from "../../../features/sso-connection/repositories/eventing/eventing.sso-connection-history.repository.ts";

const ORG = "org_acme";
const CONNECTION = "ssoconn_acme";

function connectionPipeline() {
  const model = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() };
  const database = prismaDouble({
    ssoConnection: model,
    user: model,
    organization: model,
  });
  return composeSsoConnectionGraph({
    repositories: liveRepositories(database),
    breakGlass: new StubBreakGlassBindings(true),
    commands: ConnectedIdentityEventing.create(),
    directoryMove: { migrationFinalized: async () => {} },
    licensing: licensingFixture(),
    authorization: new StubPlatformOperators(),
  }).pipeline();
}

/** The runtime's read seat over a log holding one version 1 registration a past release stored. */
async function seatOverStoredRegistration({ allowsJit }: { allowsJit: boolean }) {
  const repository = EventRepositoryMemory.createForTesting();
  await repository.insertEventRecords([
    {
      TenantId: createTenantId(ORG),
      AggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
      AggregateId: CONNECTION,
      EventId: "evt_0001",
      EventTimestamp: 1_000,
      EventOccurredAt: 1_000,
      EventType: CONNECTION_REGISTERED_V1_EVENT_TYPE,
      EventVersion: "2026-08-24",
      EventPayload: {
        connectionId: CONNECTION,
        organizationId: ORG,
        type: "oidc",
        idp: { issuer: null, providerId: "Okta", clientIdRef: null, secretRef: null, certRefs: [] },
        actor: { type: "user", id: "user_ana" },
        source: "legacy-grandfathered",
        allowsJit,
      },
      ProcessingTraceparent: "",
      IdempotencyKey: "evt_0001",
    },
  ]);
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    eventReadSeat: EventLogReadSeat.create({ repository }),
  });
  // Registered after the seat is composed, as every process registers its pipelines.
  eventing.register(connectionPipeline());
  const seat = eventing.eventReadSeat;
  if (!seat) throw new Error("the runtime holds no read seat");
  return seat;
}

describe("given a version 1 registration in the log", () => {
  describe("when the connection history is read through the runtime's read seat", () => {
    /** @scenario "Identity's history is read through eventing's read seat on a process that only produces" */
    it("answers the registration as the current type, its arrival policy derived from allowsJit", async () => {
      const seat = await seatOverStoredRegistration({ allowsJit: true });
      const repository = EventingSsoConnectionHistoryRepository.create({ eventReadSeat: seat });

      const history = await repository.findHistory({
        organizationId: ORG,
        connectionId: CONNECTION,
        limit: 10,
      });
      const [event] = await seat.findAggregateEvents({
        tenantId: createTenantId(ORG),
        aggregateType: SSO_CONNECTION_AGGREGATE_TYPE,
        aggregateId: CONNECTION,
      });

      expect(history).toEqual([
        expect.objectContaining({ eventId: "evt_0001", type: CONNECTION_REGISTERED_EVENT_TYPE }),
      ]);
      expect(event?.data).toMatchObject({ arrivalPolicy: "admit" });
      expect(event?.data).not.toHaveProperty("allowsJit");
    });
  });
});
