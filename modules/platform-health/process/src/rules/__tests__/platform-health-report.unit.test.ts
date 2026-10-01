import type { PlatformHealthCheck } from "@langwatch/platform-health-contract";
import { describe, expect, it } from "vitest";

import { httpStatusForReport, rollUpStatus } from "../platform-health-report.rules.ts";

const check = (
  name: PlatformHealthCheck["name"],
  status: PlatformHealthCheck["status"],
): PlatformHealthCheck => ({ name, status, durationMs: 1 });

describe("given every subsystem answered", () => {
  describe("when the report is rolled up", () => {
    it("reports the platform healthy and serves it", () => {
      const status = rollUpStatus([check("collector", "healthy"), check("processor", "healthy")]);
      expect(status).toBe("healthy");
      expect(httpStatusForReport(status)).toBe(200);
    });
  });
});

describe("given one subsystem did not answer", () => {
  describe("when the report is rolled up", () => {
    it("reports the platform unhealthy and answers a service failure", () => {
      const status = rollUpStatus([
        check("collector", "healthy"),
        check("processor", "unhealthy"),
        check("triggers", "not_configured"),
      ]);
      expect(status).toBe("unhealthy");
      expect(httpStatusForReport(status)).toBe(503);
    });
  });
});

describe("given a subsystem the deployment pointed nowhere", () => {
  describe("when the report is rolled up", () => {
    it("reports degraded and still serves the answer", () => {
      const status = rollUpStatus([
        check("collector", "healthy"),
        check("triggers", "not_configured"),
      ]);
      expect(status).toBe("degraded");
      expect(httpStatusForReport(status)).toBe(200);
    });
  });
});
