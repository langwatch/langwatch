/**
 * The installer, booted the way a process boots it: memory sessions, a twin of the owners'
 * settings rows, no peer, and the one namespace it contributes.
 * @see modules/presence/specs/presence.feature
 */
import { PresenceApi } from "@langwatch/presence-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { presenceProcessModule } from "../../presence.module.ts";
import { PresenceModule } from "../presence.app.ts";

const heartbeat = {
  projectId: "project-1",
  sessionId: "tab-1",
  location: { lens: "traces", route: {} },
  user: { id: "user-1", name: "Ada", image: null },
} as const;

/** Presence over memory, no peer supplied and no owners' rows handed in. */
function bootPresence() {
  return createApp({ role: "api" })
    .withModules([presenceProcessModule])
    .withStores(memoryStores())
    .boot();
}

describe("given a process that installs presence", () => {
  describe("when it boots in the api role with no peer supplied", () => {
    /** @scenario "Presence keeps no project or user peer" */
    it("names no peer it depends on", () => {
      expect(PresenceModule.dependencies).toEqual({});
    });

    /** @scenario "Over memory stores presence answers from a twin of the owners' rows" */
    it("answers from a twin of the owners' rows, which holds none, so lists no session", async () => {
      const runtime = await bootPresence();

      const presence = runtime.service(PresenceApi);
      await presence.update(heartbeat);

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
});
