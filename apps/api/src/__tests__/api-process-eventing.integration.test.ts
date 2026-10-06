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
});
