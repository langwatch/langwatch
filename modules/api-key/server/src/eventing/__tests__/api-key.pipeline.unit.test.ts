/**
 * The sweep the worker process used to assemble, now declared by the module.
 * Three things make it the same sweep: the pipeline the shared queue was
 * staged with, a revoke through THIS module's repositories rather than an
 * inert stand-in, and an outbox pruned against the installing graph's store.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { AGENT_SANDBOX_API_KEY_NAME } from "@langwatch/api-key-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyApp } from "../../app/api-key.app.ts";
import { AGENT_SANDBOX_KEY_REAP_PROCESS_NAME } from "../../processes/agent-sandbox-key-reap.process.ts";
import { MemoryApiKeyRepositories } from "../../repositories/memory/memory.api-key.repositories.ts";
import { apiKeyServer } from "../../api-key.server.ts";
import { apiKeyEventing } from "../api-key.pipeline.ts";

/** The declaration reads repositories and the process store and nothing else,
 * so standing a whole API-key application up to hand it one proves nothing. */
const unusedApp = undefined as unknown as ApiKeyApp;

function installed(participation: "produce" | "consume" = "consume") {
  const repositories = MemoryApiKeyRepositories.create();
  const revokeExpiredByName = vi.spyOn(repositories.apiKeys, "revokeExpiredByName");
  const processStore = InMemoryProcessStore.createForTesting();
  const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");
  const definition = apiKeyEventing.build({
    participation,
    repositories,
    app: unusedApp,
    processStore,
  });
  return { definition, processStore, revokeExpiredByName, deleteDispatchedBefore };
}

/** The scheduled intent the process manager runs, as the declaration built it. */
function reapIntent(definition: ReturnType<typeof installed>["definition"]) {
  const process = definition.processManagers.get(AGENT_SANDBOX_KEY_REAP_PROCESS_NAME);
  expect(process, "the sweep declared no scheduled process manager").toBeDefined();
  return process!.config.intents!.reap!.run;
}

describe("given the API-key module's eventing declaration", () => {
  describe("when the module is declared", () => {
    /** @scenario "A module declares its event sourcing beside its transports" */
    it("carries the declaration onto the installable module", () => {
      expect(apiKeyServer.eventing).toBe(apiKeyEventing);
      expect(apiKeyEventing.pipeline).toBe("agent_sandbox_maintenance");
    });
  });

  describe("when a consuming process builds it", () => {
    /** @scenario "A module declares its event sourcing beside its transports" */
    it("builds the agent-sandbox maintenance pipeline", () => {
      const { definition } = installed();

      expect(definition.metadata.name).toBe("agent_sandbox_maintenance");
      expect([...definition.processManagers.keys()]).toEqual([AGENT_SANDBOX_KEY_REAP_PROCESS_NAME]);
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("revokes through the module's own repositories when the schedule fires", async () => {
      const { definition, revokeExpiredByName } = installed();

      await reapIntent(definition)({ scheduledFor: 0 } as never, {} as never);

      expect(revokeExpiredByName).toHaveBeenCalledTimes(1);
      expect(revokeExpiredByName.mock.calls[0]![0]).toMatchObject({
        name: AGENT_SANDBOX_API_KEY_NAME,
      });
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("prunes the outbox of the graph that installed it", async () => {
      const { definition, deleteDispatchedBefore } = installed();

      await reapIntent(definition)({ scheduledFor: 0 } as never, {} as never);

      expect(deleteDispatchedBefore).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
        processName: AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
      });
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("registers in a real eventing runtime under the name the queue is staged with", () => {
      const { definition, processStore } = installed();
      const eventSourcing = EventSourcing.createForTesting({
        eventStore: EventStoreMemory.createForTesting(),
        processStore,
      });

      eventSourcing.register(definition);

      expect(eventSourcing.getPipeline("agent_sandbox_maintenance")).toBeDefined();
    });
  });
});
