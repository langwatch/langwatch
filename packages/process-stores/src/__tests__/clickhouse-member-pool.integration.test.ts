/**
 * @vitest-environment node
 * A local HTTP server stands in for ClickHouse and counts the statements it
 * holds at once, so the bound is observed where the server would enforce its own.
 */
import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";
import type { ClickHouseConfig } from "../config.ts";

const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const HOLD_MS = 50;

describe("given the ClickHouse member in front of a server", () => {
  let server: Server;
  let url: string;
  let inFlight: number;
  let peak: number;

  beforeEach(async () => {
    inFlight = 0;
    peak = 0;
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          response.setHeader("Content-Type", "application/x-ndjson");
          response.end();
        }, HOLD_MS);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port was bound.");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const burst = async ({ config, count }: { config: ClickHouseConfig; count: number }) => {
    const member = buildClickHouse({ config, directory });
    try {
      return await Promise.all(
        Array.from({ length: count }, (_, index) =>
          member.value.query({
            tenantId: "project-1",
            sql: `SELECT ${index}`,
            unscoped: { reason: "a pool-bound probe with no tenant table" },
          }),
        ),
      );
    } finally {
      await member.close?.();
    }
  };

  describe("when the server states a cap of 25 and 40 statements are sent at once", () => {
    /** @scenario "A burst over the server's cap queues within the resolved pool size" */
    it("holds the server to the resolved pool size and answers every statement", async () => {
      const results = await burst({
        config: { url, poolSizing: { serverMaxConcurrentQueries: 25 } },
        count: 40,
      });

      expect(results).toHaveLength(40);
      expect(peak).toBeLessThanOrEqual(17);
    });
  });

  describe("when the process bounds its statements below the pool size", () => {
    /** @scenario "A stated statement bound below the pool size binds instead" */
    it("holds the server to the stated bound", async () => {
      await burst({
        config: { url, poolSizing: { serverMaxConcurrentQueries: 25 }, maxConcurrentStatements: 3 },
        count: 12,
      });

      expect(peak).toBeLessThanOrEqual(3);
    });
  });
});
