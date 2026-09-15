/**
 * The installer, booted the way a process boots it: memory sessions, the peers
 * it names in `static dependencies`, and the one namespace it contributes.
 * @see modules/presence/specs/presence.feature
 */
import { PresenceApi } from "@langwatch/presence-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { presenceServer } from "../../presence.server.ts";
import {
  createPresenceTestProjects,
  createPresenceTestUsers,
  RecordingPresenceBroadcast,
  RecordingPresenceDiagnostics,
  TestPresenceEmitters,
} from "./presence.fixture.ts";

function bootPresence() {
  return createApp({ role: "api", config: {} })
    .withInfrastructure({
      broadcast: new RecordingPresenceBroadcast(),
      emitters: new TestPresenceEmitters(),
      diagnostics: new RecordingPresenceDiagnostics(),
    })
    .withProvided(ProjectApi, createPresenceTestProjects())
    .withProvided(UserApi, createPresenceTestUsers({ name: "Ada", image: null }))
    .withModules([withMemoryRepositories(presenceServer)])
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

    it("mounts presence over sessions no database was needed for", async () => {
      const runtime = await bootPresence();

      await expect(
        runtime.module(presenceServer).provided.list({ projectId: "project-1" }),
      ).resolves.toEqual([]);
    });
  });
});
