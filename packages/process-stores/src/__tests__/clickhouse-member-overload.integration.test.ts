/**
 * @vitest-environment node
 * A local HTTP server stands in for ClickHouse and holds every statement it receives until the
 * test lets go, so the member's one slot stays taken for as long as a scenario needs.
 */
import { createServer, type ServerResponse, type Server } from "node:http";

import { classifyClickHouseError, ErrorCategory } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";

const directory = { organizationForTenant: () => Promise.resolve("organization-1") };
const STATEMENT_WAIT_MS = 20_000;
const QUEUE_FLOOR = 64;

describe("given the ClickHouse member bounded at one statement in flight", () => {
  let server: Server;
  let url: string;
  let reached: number;
  let holding: boolean;
  let held: ServerResponse[];

  const answer = (response: ServerResponse) => {
    response.setHeader("Content-Type", "application/x-ndjson");
    response.end();
  };

  const letGo = () => {
    holding = false;
    for (const response of held.splice(0, held.length)) answer(response);
  };

  const untilReached = async (count: number) => {
    while (reached < count) await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(async () => {
    reached = 0;
    holding = true;
    held = [];
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        reached += 1;
        if (holding) held.push(response);
        else answer(response);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port was bound.");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    letGo();
    await new Promise((resolve) => server.close(resolve));
  });

  const member = () => buildClickHouse({ config: { url, maxConcurrentStatements: 1 }, directory });

  const statement = (client: ReturnType<typeof member>["value"], index: number) =>
    client.query({
      tenantId: "project-1",
      sql: `SELECT ${index}`,
      // A slot-bound probe that reads no tenant table.
      SKIP_TENANT_CHECK: true,
    });

  const refusalOf = (pending: Promise<unknown>) =>
    pending.then(
      () => undefined,
      (error: unknown) => error,
    );

  describe("when a second statement waits 20 seconds without a slot freeing", () => {
    /** @scenario "A statement that waits past the deadline for a slot is refused as overloaded" */
    it("refuses it as the retryable 503 clickhouse_overloaded, and the running one completes", async () => {
      const built = member();
      try {
        const running = statement(built.value, 1);
        await untilReached(1);

        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        const waiting = refusalOf(statement(built.value, 2));
        await vi.advanceTimersByTimeAsync(STATEMENT_WAIT_MS);
        const refusal = await waiting;
        vi.useRealTimers();

        expect(HandledError.isHandled(refusal)).toBe(true);
        expect(refusal).toMatchObject({
          code: "clickhouse_overloaded",
          httpStatus: 503,
          fault: "platform",
          retryable: true,
        });
        expect(reached).toBe(1);

        letGo();
        await expect(running).resolves.toMatchObject({ rows: [] });
      } finally {
        await built.close?.();
      }
    });
  });

  describe("when the wait queue of 64 is full and one more statement is sent", () => {
    /** @scenario "A statement beyond a full wait queue is refused at once" */
    it("refuses it at once as clickhouse_overloaded without reaching the server", async () => {
      const built = member();
      try {
        const running = statement(built.value, 0);
        await untilReached(1);
        const queued = Array.from({ length: QUEUE_FLOOR }, (_, index) =>
          statement(built.value, index + 1),
        );

        const refusal = await refusalOf(statement(built.value, QUEUE_FLOOR + 1));

        expect(refusal).toMatchObject({ code: "clickhouse_overloaded", httpStatus: 503 });
        expect(reached).toBe(1);

        letGo();
        await Promise.all([running, ...queued]);
      } finally {
        await built.close?.();
      }
    });

    /** @scenario "An overloaded refusal is transient, so a job re-stages it rather than dropping it" */
    it("is classified as recoverable by the event-sourcing classifier", async () => {
      const built = member();
      try {
        const running = statement(built.value, 0);
        await untilReached(1);
        const queued = Array.from({ length: QUEUE_FLOOR }, (_, index) =>
          statement(built.value, index + 1),
        );

        const refusal = await refusalOf(statement(built.value, QUEUE_FLOOR + 1));

        expect(classifyClickHouseError(refusal)).toBe(ErrorCategory.RECOVERABLE);

        letGo();
        await Promise.all([running, ...queued]);
      } finally {
        await built.close?.();
      }
    });
  });
});
