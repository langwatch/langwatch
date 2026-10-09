/**
 * @vitest-environment node
 * The readiness query against real PostgreSQL and Redis, and a store never opened left unasked.
 * Spec: specs/server/process-readiness.feature
 */
import { describe, expect, it } from "vitest";

import { buildProcessStores } from "../src/create-members.ts";
import type { ProcessConfig } from "../src/index.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const REDIS_URL = process.env.LANGWATCH_TEST_REDIS_URL;

describe.skipIf(!DB_URL || !REDIS_URL)("given a process that opened PostgreSQL and Redis", () => {
  const config: ProcessConfig = {
    processName: "store-readiness-integration",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
    database: { url: DB_URL ?? "" },
    redis: { url: REDIS_URL ?? "" },
    // Configured but never read: nothing listens on port 1, so asking it would fail.
    clickhouse: { url: "http://127.0.0.1:1" },
  };

  describe("when readiness asks the stores", () => {
    /** @scenario "Each opened store answers one cheap check" */
    it("each opened client answers, and the unopened ClickHouse is not asked", async () => {
      const members = buildProcessStores({ config }).members;
      try {
        members.read("prisma");
        members.read("redis");

        await expect(members.answer?.()).resolves.toBeUndefined();
      } finally {
        await members.close();
      }
    });
  });
});
