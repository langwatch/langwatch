import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanupTestData,
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "./testContainers";

const TEST_DATABASE = "test_langwatch";

/**
 * Regression guard for #5308. `test_event_handler_log` is created lazily (only
 * when the map projection runs), so any test that calls `cleanupTestData(tenantId)`
 * without it hits an `ALTER TABLE ... DELETE` on an absent table. The
 * `@clickhouse/client` default logger writes that error to `console.error` BEFORE
 * the promise rejects, so the caller's try/catch silences the throw but not the
 * log line, which has twice masqueraded as a real failure (#4824, PR #5071). The
 * fix guards the DELETE on `EXISTS TABLE`; this test executes the path and asserts
 * the client never logs the missing-table error.
 */
describe("cleanupTestData benign missing-table log-noise (#5308)", () => {
  beforeAll(async () => {
    await startTestContainers();
  });

  afterAll(async () => {
    await stopTestContainers();
  });

  describe("given test_event_handler_log does not exist", () => {
    describe("when cleanupTestData runs for a tenant", () => {
      it("does not log a Could not find table error from the ClickHouse client", async () => {
        const client = getTestClickHouseClient();
        expect(client).not.toBeNull();

        // Guarantee the lazily-created table is absent for this run.
        await client!.exec({
          query: `DROP TABLE IF EXISTS "${TEST_DATABASE}".test_event_handler_log`,
        });

        const errorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        let loggedArgs: string[] = [];
        try {
          await cleanupTestData("noise-guard-tenant");
        } finally {
          loggedArgs = errorSpy.mock.calls.flat().map((arg) => {
            if (typeof arg === "string") return arg;
            if (arg instanceof Error) return `${arg.stack ?? arg.message}`;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          });
          errorSpy.mockRestore();
        }

        const haystack = loggedArgs.join(" ");
        expect(haystack).not.toContain("test_event_handler_log");
        expect(haystack).not.toContain("Could not find table");
      });
    });
  });
});
