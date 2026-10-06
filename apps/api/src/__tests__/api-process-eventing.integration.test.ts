/**
 * The api's Eventing runtime as the api role composes it: producer-only, with no event log.
 * @vitest-environment node
 * @see specs/server/api-process-eventing.feature
 */
import {
  createTenantId,
  EventSourcing,
  EventStoreProducerOnly,
  InMemoryProcessStore,
} from "@langwatch/eventing";
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

describe("the api process's Eventing runtime", () => {
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
