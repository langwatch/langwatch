/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * End-to-end wiring proof that the internal/service routes reject callers who
 * do not present the shared secret — covered by the destructive
 * old-lambdas-cleanup cron route (representative of every cronPolicy()-gated
 * endpoint).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app as cronApp } from "../cron";

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

  describe("when a destructive cron route is called", () => {
    /** @scenario "A destructive cron route rejects callers without the secret" */
    it("rejects a request with no Authorization header", async () => {
      const res = await cronApp.request(
        "/api/cron/old_lambdas_cleanup",
        { method: "POST" },
      );
      expect(res.status).toBe(401);
    });

    it("rejects a request with the wrong secret", async () => {
      const res = await cronApp.request(
        "/api/cron/old_lambdas_cleanup",
        { method: "POST", headers: { authorization: "Bearer wrong" } },
      );
      expect(res.status).toBe(401);
    });
  });
});
