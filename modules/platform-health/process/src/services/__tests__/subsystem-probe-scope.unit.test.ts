/**
 * A probe credential that self-scopes to one project cannot be re-resolved
 * behind the public boundary, so every canary repeats the resolution this side
 * already made.
 * @see modules/platform-health/specs/platform-health.feature
 */
import { describe, expect, it } from "vitest";

import { MemorySubsystemProbeChannel } from "../../channels/memory/memory.subsystem-probe.channel.ts";
import { SubsystemProbeService } from "../subsystem-probe.service.ts";

function probes(canaries: MemorySubsystemProbeChannel) {
  return SubsystemProbeService.create({
    collaborators: {
      canaries,
      automation: () => ({
        findById: async () => null,
        getRecentFires: async () => [],
      }),
      workflowExists: async () => true,
    },
  });
}

function headersOf(canaries: MemorySubsystemProbeChannel): Readonly<Record<string, string>>[] {
  return canaries.requests().map((request) => request.headers);
}

describe("subsystem probes", () => {
  describe("when the probe credential resolved a project", () => {
    /** @scenario "A probe credential scoped to one project stays scoped downstream" */
    it("names that project on every canary it posts", async () => {
      const canaries = MemorySubsystemProbeChannel.create();

      await probes(canaries).runCollector({ authToken: "token", projectId: "project_1" });

      expect(headersOf(canaries)).toHaveLength(2);
      for (const headers of headersOf(canaries)) {
        expect(headers["X-Project-Id"]).toBe("project_1");
        expect(headers["X-Auth-Token"]).toBe("token");
      }
    });
  });

  describe("when the probe credential resolves to no project", () => {
    it("posts the canary with the token alone", async () => {
      const canaries = MemorySubsystemProbeChannel.create();

      await probes(canaries).runCollector({ authToken: "token", projectId: null });

      for (const headers of headersOf(canaries)) {
        expect(headers).not.toHaveProperty("X-Project-Id");
      }
    });
  });
});
