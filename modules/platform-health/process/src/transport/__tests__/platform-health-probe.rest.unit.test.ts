/**
 * @vitest-environment node
 * The probe doors: each service answer written as the HTTP response main's probes answered.
 */
import { describe, expect, it } from "vitest";

import {
  langyProbeResponseOf,
  projectKeyedProbeResponseOf,
} from "../platform-health-probe.rest.ts";

describe("projectKeyedProbeResponseOf", () => {
  describe("when the answer may be cached", () => {
    /** @scenario "A project-keyed probe answer is JSON at its own status with no cache header" */
    it("writes its body as JSON at its status, with no cache header", async () => {
      const response = projectKeyedProbeResponseOf({
        status: 401,
        body: { message: "Invalid auth token." },
        noStore: false,
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("cache-control")).toBeNull();
      expect(await response.text()).toBe('{"message":"Invalid auth token."}');
    });
  });

  describe("when the answer is a scenario canary's", () => {
    /** @scenario "A scenario canary answer is marked no-store" */
    it("marks it no-store", () => {
      const response = projectKeyedProbeResponseOf({
        status: 200,
        body: { status: "ok" },
        noStore: true,
      });

      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
    });
  });
});

describe("langyProbeResponseOf", () => {
  describe("when the surface is dark", () => {
    /** @scenario "A dark Langy probe is a plain not-found" */
    it("answers Hono's own plain 404", async () => {
      const response = langyProbeResponseOf({ kind: "dark" });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
      expect(response.headers.get("cache-control")).toBeNull();
      expect(await response.text()).toBe("404 Not Found");
    });
  });

  describe("when the canary answered", () => {
    /** @scenario "A Langy canary answer is uncacheable JSON at its status" */
    it("writes its body as uncacheable JSON at its status", async () => {
      const response = langyProbeResponseOf({
        kind: "canary",
        status: 503,
        body: { status: "unhealthy", reason: "timeout" },
      });

      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ status: "unhealthy", reason: "timeout" });
    });
  });
});
