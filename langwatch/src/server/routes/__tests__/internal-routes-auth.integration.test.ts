/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * End-to-end wiring proof that the internal/service routes reject callers who
 * do not present the shared secret — covering the destructive cron job
 * (traces retention cleanup) and the worker/ops trigger endpoints that
 * previously had no authentication at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app as cronApp } from "../cron";
import { app as miscApp } from "../misc";

const SECRET = "integration-internal-secret";

describe("internal/service route authentication", () => {
  let original: string | undefined;
  beforeAll(() => {
    original = process.env.CRON_API_KEY;
    process.env.CRON_API_KEY = SECRET;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.CRON_API_KEY;
    else process.env.CRON_API_KEY = original;
  });

  describe("when the destructive retention-cleanup cron route is called", () => {
    /** @scenario "A destructive cron route rejects callers without the secret" */
    it("rejects a request with no Authorization header", async () => {
      const res = await cronApp.request(
        "/api/cron/traces_retention_period_cleanup",
        { method: "POST" },
      );
      expect(res.status).toBe(401);
    });

    it("rejects a request with the wrong secret", async () => {
      const res = await cronApp.request(
        "/api/cron/traces_retention_period_cleanup",
        { method: "POST", headers: { authorization: "Bearer wrong" } },
      );
      expect(res.status).toBe(401);
    });
  });

  describe("when the worker/ops trigger endpoints are called", () => {
    /** @scenario "Worker and ops trigger endpoints reject callers without the secret" */
    it("rejects /api/start_workers without the secret", async () => {
      const res = await miscApp.request("/api/start_workers", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("rejects /api/rerun_checks without the secret", async () => {
      const res = await miscApp.request(
        "/api/rerun_checks?checkId=c&projectId=p",
        { method: "POST" },
      );
      expect(res.status).toBe(401);
    });
  });
});
