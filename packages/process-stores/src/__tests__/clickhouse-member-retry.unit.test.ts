/**
 * The ClickHouse member retries a transient statement in place, except one over the memory limit.
 * @see specs/analytics/clickhouse-memory-safety.feature
 */
import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";

const directory = { organizationForTenant: () => Promise.resolve("organization-1") };

const MEMORY_ERRORS = [
  {
    label: "a ClickHouse exception the driver parses into its code",
    message:
      "Code: 241. DB::Exception: Query memory limit exceeded: would use 2.01 GiB (attempt to allocate chunk of 4.00 MiB), maximum: 1.86 GiB: While executing CreatingSetsTransform. (MEMORY_LIMIT_EXCEEDED)",
  },
  {
    label: "an exception relayed without its code prefix, named only in the message",
    message:
      "User memory limit exceeded: would use 9.31 GiB, maximum: 9.31 GiB. OvercommitTracker decision: Query was selected to stop by OvercommitTracker. (MEMORY_LIMIT_EXCEEDED)",
  },
] as const;

const TOO_MANY_QUERIES = {
  code: "202",
  message: "Code: 202. DB::Exception: Too many simultaneous queries. Maximum: 100.",
};

let server: Server;
let url: string;
let requests = 0;
let answers: { code: string; message: string }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requests += 1;
      const failure = answers.shift();
      if (failure) {
        response.statusCode = 500;
        response.setHeader("X-ClickHouse-Exception-Code", failure.code);
        response.end(failure.message);
        return;
      }
      response.setHeader("Content-Type", "application/x-ndjson");
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port was bound.");
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = 0;
  answers = [];
});

const probe = {
  tenantId: "project-1",
  sql: "SELECT 1",
  unscoped: { reason: "a probe with no tenant table" },
} as const;

describe("given a process that built its ClickHouse member", () => {
  for (const { label, message } of MEMORY_ERRORS) {
    describe(`when a read fails over the memory limit with ${label}`, () => {
      /** @scenario "A query over the memory limit is not retried in place" */
      it("fails on the first attempt without retrying it", async () => {
        answers = [
          { code: "241", message },
          { code: "241", message },
        ];
        const member = buildClickHouse({ config: { url }, directory });
        try {
          const rejection = await member.value.query(probe).catch((error: unknown) => error);
          expect(rejection).toBeInstanceOf(Error);
        } finally {
          await member.close?.();
        }

        expect(requests).toBe(1);
      });
    });
  }

  describe("when a read is refused for too many simultaneous queries", () => {
    it("retries it in place and answers", async () => {
      answers = [TOO_MANY_QUERIES];
      const member = buildClickHouse({ config: { url }, directory });
      try {
        await member.value.query(probe);
      } finally {
        await member.close?.();
      }

      expect(requests).toBe(2);
    });
  });
});
