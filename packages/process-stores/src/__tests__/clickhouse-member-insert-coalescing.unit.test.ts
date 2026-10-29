/**
 * The built ClickHouse member coalesces async inserts that wait for a slot (ADR-187): a server
 * that holds each insert's answer stands in for ClickHouse and counts the statements and rows.
 * Spec: specs/clickhouse/single-client-access.feature
 */
import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";

const directory = {
  organizationForTenant: () => Promise.resolve("organization-1"),
};

/** event_log's settings: async, waiting for the flush, async deduplication off. */
const SHARED = {
  async_insert: 1,
  wait_for_async_insert: 1,
  async_insert_deduplicate: 0,
};

let server: Server;
let url: string;
const statements: number[] = [];
const held: (() => void)[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      statements.push(
        body.split("\n").filter((line) => line.length > 0).length,
      );
      held.push(() => {
        response.setHeader("Content-Type", "application/x-ndjson");
        response.end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port was bound.");
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
};

describe("given a process that built its ClickHouse member with one insert slot", () => {
  describe("when async inserts arrive while that slot is held", () => {
    /** @scenario async inserts waiting for a slot go as one statement */
    it("sends them as one statement once the slot frees", async () => {
      // A budget of two keeps one slot for reads, so the insert lane holds one.
      const member = buildClickHouse({
        config: { url, maxConcurrentStatements: 2 },
        directory,
      });
      const insert = (n: number) =>
        member.value.insert({
          tenantId: "project-1",
          table: "event_log",
          rows: [{ TenantId: "project-1", n }],
          settings: SHARED,
        });
      try {
        const first = insert(0);
        await waitFor(() => held.length === 1);

        const writes = Promise.all([first, ...[1, 2, 3].map(insert)]);
        let settled = false;
        void writes.finally(() => {
          settled = true;
        });
        while (!settled) {
          for (const answer of held.splice(0)) answer();
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await writes;
      } finally {
        await member.close?.();
      }

      expect(statements).toEqual([1, 3]);
    });
  });
});
