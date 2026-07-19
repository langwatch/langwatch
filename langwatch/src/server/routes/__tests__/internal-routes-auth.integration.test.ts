/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * End-to-end wiring proof that the internal/service routes reject callers who
 * do not present the shared secret. Enforcement is structural — the
 * builder-level `verifySecret` middleware on createServiceApp gates every
 * registered route — and each route is asserted individually so a route that
 * escapes the gate (or a regression in the gate itself) fails here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app as cronApp } from "../cron";

const SECRET = "integration-internal-secret";

const CRON_ROUTES: { method: "GET" | "POST"; path: string }[] = [
  { method: "POST", path: "/api/cron/old_lambdas_cleanup" },
  { method: "GET", path: "/api/cron/old_lambdas_cleanup" },
  { method: "POST", path: "/api/cron/schedule_topic_clustering" },
  { method: "GET", path: "/api/cron/schedule_topic_clustering" },
  { method: "GET", path: "/api/cron/trace_analytics" },
  { method: "POST", path: "/api/cron/seed_demo" },
  { method: "GET", path: "/api/cron/seed_demo" },
];

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

  describe("when a cron route is called without credentials", () => {
    /** @scenario "A destructive cron route rejects callers without the secret" */
    it.each(CRON_ROUTES)(
      "rejects $method $path with no Authorization header",
      async ({ method, path }) => {
        const res = await cronApp.request(path, { method });
        expect(res.status).toBe(401);
      },
    );
  });

  describe("when a cron route is called with the wrong secret", () => {
    it.each(CRON_ROUTES)(
      "rejects $method $path with a mismatched bearer token",
      async ({ method, path }) => {
        const res = await cronApp.request(path, {
          method,
          headers: { authorization: "Bearer wrong" },
        });
        expect(res.status).toBe(401);
      },
    );
  });
});
