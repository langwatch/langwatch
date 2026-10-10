/**
 * The api's Eventing runtime as the api role composes it: producer-only, with no event log, and
 * a one-event read seat beside its store.
 * @vitest-environment node
 * @see specs/server/api-process-eventing.feature
 */
import {
  createTenantId,
  EventLogReadSeat,
  EventSourcing,
  EventStoreProducerOnly,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventRepositoryMemory } from "@langwatch/eventing/testing";
import { JOIN_REQUEST_PIPELINE_NAME } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { bootApi } from "./api-installation.fixture.ts";

const PROCESS_NAME = "langwatch-api";

/** The runtime the api role installs: `producerEventing`'s store and process-manager mode. */
function apiEventing(): EventSourcing {
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: PROCESS_NAME }),
    consumersEnabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
    processStore: InMemoryProcessStore.createForTesting(),
  });
}

/** The api runtime over a queue that records what is staged on it and executes nothing. */
function stagingApiEventing() {
  const staged: unknown[] = [];
  const eventing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: PROCESS_NAME }),
    consumersEnabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
    processStore: InMemoryProcessStore.createForTesting(),
    queueFactory: () =>
      ({
        send: async (payload: unknown) => void staged.push(payload),
        close: async () => {},
        start: () => {},
      }) as never,
  });
  return { eventing, staged };
}

/** The api runtime with the read seat `buildEventing` composes beside the refusing store. */
async function apiEventingWithReadSeat() {
  const repository = EventRepositoryMemory.createForTesting();
  await repository.insertEventRecords([
    {
      TenantId: "project-1",
      AggregateType: "trace",
      AggregateId: "trace-1",
      EventId: "event-1",
      EventTimestamp: 1_700_000_000_000,
      EventOccurredAt: 1_700_000_000_000,
      EventType: "lw.obs.trace.span_received",
      EventVersion: "2025-12-14",
      EventPayload: { body: "the whole log line" },
      ProcessingTraceparent: "",
      IdempotencyKey: "event-1",
    },
  ]);
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: PROCESS_NAME }),
    eventReadSeat: EventLogReadSeat.create({ repository }),
    consumersEnabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
    processStore: InMemoryProcessStore.createForTesting(),
  });
}

describe("the api process's Eventing runtime", () => {
  describe("when it composes a read seat beside its producer-only store", () => {
    /** @scenario "The API process answers one event through its read seat" */
    it("answers one event through the seat while its store still refuses reads", async () => {
      const eventing = await apiEventingWithReadSeat();
      const { runtime } = await bootApi({ eventing });
      const read = {
        tenantId: createTenantId("project-1"),
        aggregateType: "trace" as const,
        aggregateId: "trace-1",
        eventId: "event-1",
      };

      try {
        await expect(eventing.eventReadSeat?.getEvent(read)).resolves.toMatchObject({
          id: "event-1",
          data: { body: "the whole log line" },
        });
        await expect(eventing.eventStore!.getEvent(read)).rejects.toThrow(
          new RegExp(`${PROCESS_NAME}.*getEvent`, "s"),
        );
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "The API process answers one aggregate's events through its read seat" */
    it("answers an aggregate's events through the seat while its store still refuses reads", async () => {
      const eventing = await apiEventingWithReadSeat();
      const { runtime } = await bootApi({ eventing });
      const stream = {
        tenantId: createTenantId("project-1"),
        aggregateType: "trace" as const,
        aggregateId: "trace-1",
      };

      try {
        const events = await eventing.eventReadSeat?.getEvents(stream);

        expect(events?.map((event) => event.id)).toEqual(["event-1"]);
        await expect(
          eventing.eventStore!.getEvents({
            aggregateId: stream.aggregateId,
            aggregateType: stream.aggregateType,
            context: { tenantId: stream.tenantId },
          }),
        ).rejects.toThrow(new RegExp(`${PROCESS_NAME}.*getEvents`, "s"));
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when every installed module registers its pipelines on it", () => {
    /** @scenario "The API process's Eventing runtime owns no event log" */
    it("refuses an append and names the process", async () => {
      const eventing = apiEventing();
      const { runtime } = await bootApi({ eventing });

      try {
        const store = eventing.eventStore;
        if (store === undefined) throw new Error("the api runtime holds no event store seat");

        await expect(
          store.storeEvents([], { tenantId: createTenantId("organization-1") }, "trace"),
        ).rejects.toThrow(new RegExp(`${PROCESS_NAME}.*storeEvents`, "s"));
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "The API process's Eventing runtime runs no process managers" */
    it("registers pipelines whole, declines their process managers by name and has no process runtime", async () => {
      const eventing = apiEventing();
      const { runtime } = await bootApi({ eventing });

      try {
        const declined = eventing.unrunProcessManagers;
        expect(declined).not.toEqual([]);
        const withManagers = eventing.definitions.filter((definition) =>
          declined.some((name) => definition.processManagers.has(name)),
        );
        expect(withManagers).not.toEqual([]);
        expect(
          withManagers.some((definition) => definition.open((open) => open.commands.length > 0)),
        ).toBe(true);
        expect(() => eventing.processRuntime).toThrow(
          expect.objectContaining({ name: "ConfigurationError", component: "EventSourcing" }),
        );
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the identity join-request pipeline is registered producer-only", () => {
    /** @scenario "A join request command lands on this process's own event stack" */
    it("stages the join command on its own sender, appends nothing and declines the lifecycle", async () => {
      const { eventing, staged } = stagingApiEventing();
      const { runtime } = await bootApi({ eventing });

      try {
        const sender = eventing.getPipeline(JOIN_REQUEST_PIPELINE_NAME).commands.requestJoin;
        expect(sender, "the registration produced no requestJoin sender").toBeDefined();
        await sender!.send({
          tenantId: "organization-1",
          organizationId: "organization-1",
          joinRequestId: "joinreq-1",
          commandId: "joincmd-1",
          occurredAtMs: 1_700_000_000_000,
          actor: { type: "user", id: "user-1" },
          userId: "user-1",
          domain: "acme.example",
          matchedVia: "verified-identifier-domain",
          expiresAtMs: 1_700_000_100_000,
          notifyAdmins: true,
        });

        expect(staged).toHaveLength(1);
        expect(JSON.stringify(staged[0])).toContain("joinreq-1");
        expect(eventing.unrunProcessManagers).toContain("joinRequestLifecycle");
        await expect(
          eventing.eventStore!.storeEvents(
            [],
            { tenantId: createTenantId("organization-1") },
            "joinRequest",
          ),
        ).rejects.toThrow(new RegExp(`${PROCESS_NAME}.*storeEvents`, "s"));
      } finally {
        await runtime.stop();
      }
    });
  });
});
