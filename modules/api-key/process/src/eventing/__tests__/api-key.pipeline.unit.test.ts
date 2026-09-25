/**
 * The sweeps the worker process used to assemble, now declared by the module: same pipeline, a
 * revoke through this module's own repositories rather than an inert stand-in, and an outbox
 * pruned against the installing graph's store.
 */

/** Spec: specs/server/declarative-process-composition.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import { AGENT_SANDBOX_API_KEY_NAME } from "@langwatch/api-key-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { apiKeyServer } from "../../api-key.server.ts";
import type { ApiKeyApp } from "../../app/api-key.app.ts";
import { MemoryApiKeyRepositories } from "../../repositories/memory/memory.api-key.repositories.ts";
import { AGENT_SANDBOX_KEY_REAP_PROCESS_NAME } from "../agent-sandbox-key-reap.process.ts";
import { apiKeyEventing } from "../api-key.pipeline.ts";
import { CLI_LOGIN_KEY_REAP_PROCESS_NAME } from "../cli-login-key-reap.process.ts";

/** The sandbox sweep never calls into the app, so a stand-in proves nothing there. */
const unusedApp = createApiFixture<ApiKeyApp>();

function installed(participation: "produce" | "consume" = "consume") {
  const repositories = MemoryApiKeyRepositories.create();
  const revokeExpiredByName = vi.spyOn(repositories.apiKeys, "revokeExpiredByName");
  const findElapsedLoginKeys = vi.spyOn(repositories.apiKeys, "findElapsedLoginKeys");
  const revoke = vi.fn(async (input: { id: string }) => ({ id: input.id }) as never);
  const app = createApiFixture<ApiKeyApp>({ revoke });
  const processStore = InMemoryProcessStore.createForTesting();
  const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");
  const definition = apiKeyEventing.build({
    participation,
    repositories,
    app,
    processStore,
  });
  return {
    definition,
    processStore,
    revokeExpiredByName,
    findElapsedLoginKeys,
    revoke,
    deleteDispatchedBefore,
  };
}

/** The scheduled intent one process manager runs, as the declaration built it. */
function reapIntentOf(definition: ReturnType<typeof installed>["definition"], processName: string) {
  const process = definition.processManagers.get(processName);
  expect(process, `the sweep declared no "${processName}" process manager`).toBeDefined();
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
    it("builds the agent-sandbox maintenance pipeline with both credential sweeps", () => {
      const { definition } = installed();

      expect(definition.metadata.name).toBe("agent_sandbox_maintenance");
      expect(new Set(definition.processManagers.keys())).toEqual(
        new Set([AGENT_SANDBOX_KEY_REAP_PROCESS_NAME, CLI_LOGIN_KEY_REAP_PROCESS_NAME]),
      );
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("revokes sandbox keys through the module's own repositories when the schedule fires", async () => {
      const { definition, revokeExpiredByName } = installed();

      await reapIntentOf(definition, AGENT_SANDBOX_KEY_REAP_PROCESS_NAME)(
        { scheduledFor: 0 } as never,
        {} as never,
      );

      expect(revokeExpiredByName).toHaveBeenCalledTimes(1);
      expect(revokeExpiredByName.mock.calls[0]![0]).toMatchObject({
        name: AGENT_SANDBOX_API_KEY_NAME,
      });
    });

    /** @scenario "The worker composes the CLI login-key sweep from the feature package" */
    it("revokes elapsed CLI login keys through the installing graph's own app", async () => {
      const { definition, findElapsedLoginKeys, revoke } = installed();

      await reapIntentOf(definition, CLI_LOGIN_KEY_REAP_PROCESS_NAME)(
        { scheduledFor: 0 } as never,
        {} as never,
      );

      expect(findElapsedLoginKeys).toHaveBeenCalledTimes(1);
      // A raw repository update would skip the bindings cleanup and the
      // parent cascade; going through `app.revoke` is what buys both.
      expect(revoke).not.toHaveBeenCalled(); // no elapsed keys seeded in this test
    });

    /** @scenario "The worker composes the CLI login-key sweep from the feature package" */
    it("prunes each sweep's own outbox against the graph that installed it", async () => {
      const { definition, deleteDispatchedBefore } = installed();

      await reapIntentOf(definition, AGENT_SANDBOX_KEY_REAP_PROCESS_NAME)(
        { scheduledFor: 0 } as never,
        {} as never,
      );
      await reapIntentOf(definition, CLI_LOGIN_KEY_REAP_PROCESS_NAME)(
        { scheduledFor: 0 } as never,
        {} as never,
      );

      expect(deleteDispatchedBefore).toHaveBeenCalledTimes(2);
      expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
        processName: AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
      });
      expect(deleteDispatchedBefore.mock.calls[1]![0]).toMatchObject({
        processName: CLI_LOGIN_KEY_REAP_PROCESS_NAME,
      });
    });

    /** @scenario "A module declares its event sourcing beside its transports" */
    it("registers in a real eventing runtime under the name the queue is staged with", () => {
      const { processStore } = installed();
      const definition = apiKeyEventing.build({
        participation: "consume",
        repositories: MemoryApiKeyRepositories.create(),
        app: unusedApp,
        processStore,
      });
      const eventSourcing = EventSourcing.createForTesting({
        eventStore: EventStoreMemory.createForTesting(),
        processStore,
      });

      eventSourcing.register(definition);

      expect(eventSourcing.getPipeline("agent_sandbox_maintenance")).toBeDefined();
    });
  });
});
