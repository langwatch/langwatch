import { createApp, withMemoryRepositories } from "@langwatch/kernel";
/**
 * The installer, booted the way a process boots it: memory sessions, the peers
 * it names in `static dependencies`, and the one namespace it contributes.
 * @see modules/presence/specs/presence.feature
 */
import { PresenceApi } from "@langwatch/presence-contract";
import { describe, expect, it } from "vitest";

import { presenceServer } from "../../presence.server.ts";
import { createPresenceTestProjects, createPresenceTestUsers } from "./presence.fixture.ts";

function bootPresence() {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(presenceServer)])
    .withMember("keyvalue", null)
    .withMember("logging", { warn: () => undefined })
    .provide({
      project: createPresenceTestProjects(),
      user: createPresenceTestUsers({ name: "Ada", image: null }),
    })
    .boot();
}

describe("given a process that installs presence", () => {
  describe("when it boots in the api role", () => {
    it("answers the presence API from the token the feature declared", async () => {
      const runtime = await bootPresence();

      const presence = runtime.service(PresenceApi);
      await presence.update({
        projectId: "project-1",
        sessionId: "tab-1",
        location: { lens: "traces", route: {} },
        userId: "user-1",
      });

      await expect(presence.list({ projectId: "project-1" })).resolves.toMatchObject([
        { sessionId: "tab-1", user: { id: "user-1", name: "Ada" } },
      ]);
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
        runtime.module(presenceServer).provided.list({ projectId: "project-1" }),
      ).resolves.toEqual([]);
    });
  });
});
