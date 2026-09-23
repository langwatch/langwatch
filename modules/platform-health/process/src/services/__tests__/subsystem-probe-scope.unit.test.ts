/**
 * A probe credential that self-scopes to one project cannot be re-resolved
 * behind the public boundary, so every canary repeats the resolution this side
 * already made.
 * @see modules/platform-health/specs/platform-health.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubsystemProbeService } from "../subsystem-probe.service.ts";

function probes() {
  return SubsystemProbeService.create({
    collaborators: {
      publicBaseUrl: "https://example.invalid",
      automation: () => ({
        findById: async () => null,
        getRecentFires: async () => [],
      }),
      workflowExists: async () => true,
    },
  });
}

function headersOf(fetchSpy: ReturnType<typeof vi.fn>): Record<string, string>[] {
  return fetchSpy.mock.calls.map(
    (call) => (call[1] as { headers: Record<string, string> }).headers,
  );
}

describe("subsystem probes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("when the probe credential resolved a project", () => {
    /** @scenario "A probe credential scoped to one project stays scoped downstream" */
    it("names that project on every canary it posts", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);

      await probes().runCollector({ authToken: "token", projectId: "project_1" });

      expect(headersOf(fetchSpy)).toHaveLength(2);
      for (const headers of headersOf(fetchSpy)) {
        expect(headers["X-Project-Id"]).toBe("project_1");
        expect(headers["X-Auth-Token"]).toBe("token");
      }
    });
  });

  describe("when the probe credential resolves to no project", () => {
    it("posts the canary with the token alone", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);

      await probes().runCollector({ authToken: "token", projectId: null });

      for (const headers of headersOf(fetchSpy)) {
        expect(headers).not.toHaveProperty("X-Project-Id");
      }
    });
  });
});
