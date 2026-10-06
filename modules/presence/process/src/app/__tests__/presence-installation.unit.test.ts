/**
 * The installer, booted the way a process boots it: memory sessions and settings, no peer, and
 * the one namespace it contributes; on the worker, its settings subscribers beside project's facts.
 * @see modules/presence/specs/presence.feature
 */
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { PresenceApi } from "@langwatch/presence-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { settingsFactOwner } from "../../eventing/__tests__/presence-settings.fixture.ts";
import { presenceProcessModule } from "../../presence.module.ts";
import { PresenceModule } from "../presence.app.ts";

const heartbeat = {
  projectId: "project-1",
  sessionId: "tab-1",
  location: { lens: "traces", route: {} },
  user: { id: "user-1", name: "Ada", image: null },
} as const;

/** Presence over memory, no peer supplied; on the worker, it hosts the given eventing. */
function composePresence(worker?: { eventing: EventSourcing }) {
  const app = createApp({ role: worker ? "worker" : "api" })
    .withModules([withMemoryRepositories(presenceProcessModule)])
    .withMembers({ keyvalue: null, logging: { warn: () => undefined } });
  return worker ? app.withEventing(worker.eventing) : app;
}

function bootPresence() {
  return composePresence().boot();
}

/** A worker hosting presence's settings subscribers, and an append for project's facts. */
async function bootPresenceWorker() {
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
  const append = settingsFactOwner(eventing);
  const runtime = await composePresence({ eventing }).boot();
  return { runtime, append, eventing };
}

describe("given a process that installs presence", () => {
  describe("when it boots in the api role with no peer supplied", () => {
    /** @scenario "Presence keeps no project or user peer" */
    it("names no peer and answers from its own fold, which knows no project yet", async () => {
      const runtime = await bootPresence();

      const presence = runtime.service(PresenceApi);
      await presence.update(heartbeat);

      expect(PresenceModule.dependencies).toEqual({});
      await expect(presence.isEnabledForProject({ projectId: "project-1" })).resolves.toBe(false);
      await expect(presence.list({ projectId: "project-1" })).resolves.toEqual([]);
    });

    /** @scenario "A langy conversation update reaches only the project it was published for" */
    it("relays a langy conversation update to its own project's tenant emitter only", async () => {
      const runtime = await bootPresence();
      await runtime.start();
      const presence = runtime.service(PresenceApi);
      const own: unknown[] = [];
      const other: unknown[] = [];
      presence.getTenantEmitter("project-1").on("langy_conversation_updated", (frame) => {
        own.push(frame);
      });
      presence.getTenantEmitter("project-2").on("langy_conversation_updated", (frame) => {
        other.push(frame);
      });

      try {
        await presence.publishProjectEvent({
          projectId: "project-1",
          channel: "langy_conversation_updated",
          event: JSON.stringify({ conversationId: "conv-1", ownerUserId: "user-1" }),
        });

        expect(own).toEqual([
          expect.objectContaining({
            event: JSON.stringify({ conversationId: "conv-1", ownerUserId: "user-1" }),
          }),
        ]);
        expect(other).toEqual([]);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A peer's project signal reaches only the project it was published for" */
    it.each(["trace_updated", "discover_updated", "simulation_updated"] as const)(
      "relays a %s signal to its own project's tenant emitter only",
      async (channel) => {
        const runtime = await bootPresence();
        await runtime.start();
        const presence = runtime.service(PresenceApi);
        const own: unknown[] = [];
        const other: unknown[] = [];
        presence.getTenantEmitter("project-1").on(channel, (frame) => own.push(frame));
        presence.getTenantEmitter("project-2").on(channel, (frame) => other.push(frame));

        try {
          await presence.publishProjectEvent({ projectId: "project-1", channel, event: "{}" });

          expect(own).toEqual([expect.objectContaining({ event: "{}" })]);
          expect(other).toEqual([]);
        } finally {
          await runtime.stop();
        }
      },
    );

    /** @scenario "A tiered project signal is dropped once the project's allowance is spent" */
    it("drops delta signals past the project's allowance", async () => {
      const runtime = await bootPresence();
      await runtime.start();
      const presence = runtime.service(PresenceApi);
      const received: unknown[] = [];
      presence.getTenantEmitter("project-1").on("simulation_updated", (frame) => {
        received.push(frame);
      });

      try {
        for (let sent = 0; sent < 600; sent += 1) {
          await presence.publishProjectEvent({
            projectId: "project-1",
            channel: "simulation_updated",
            event: "{}",
            tier: "delta",
          });
        }

        expect(received.length).toBeGreaterThan(0);
        expect(received.length).toBeLessThan(600);
      } finally {
        await runtime.stop();
      }
    });

    it("mounts presence over sessions no database was needed for", async () => {
      const runtime = await bootPresence();

      await expect(
        runtime.module(presenceProcessModule).provided.list({ projectId: "project-1" }),
      ).resolves.toEqual([]);
    });
  });

  describe("when it boots in the worker role beside project's pipeline", () => {
    /** @scenario "A heartbeat counts once presence has folded the project's creation" */
    it("lists a heartbeat's session once the project's creation is folded", async () => {
      const { runtime, append, eventing } = await bootPresenceWorker();
      await runtime.start();
      const presence = runtime.service(PresenceApi);

      try {
        await append(
          {
            type: PROJECT_CREATED_EVENT_TYPE,
            data: {
              tenantId: "project-1",
              projectId: "project-1",
              organizationId: "organization-1",
              occurredAt: 10,
            },
          },
          "event-created",
        );
        await vi.waitFor(async () =>
          expect(await presence.isEnabledForProject({ projectId: "project-1" })).toBe(true),
        );
        await presence.update(heartbeat);

        await expect(presence.list({ projectId: "project-1" })).resolves.toMatchObject([
          { sessionId: "tab-1", user: { id: "user-1", name: "Ada" } },
        ]);
      } finally {
        await runtime.stop();
        await eventing.close();
      }
    });
  });
});
