import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { RetryPolicy } from "../retry.ts";
import { TenantGuard } from "../tenantGuard.ts";

const unusedExecute = async (): Promise<never> => {
  throw new Error("a read is not part of this case");
};
const unusedCommand = async (): Promise<void> => {
  throw new Error("command is not part of this case");
};

function socketError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function clientWith(insert: () => Promise<void>) {
  return new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: { execute: unusedExecute, insert, command: unusedCommand },
    retries: new RetryPolicy({
      sleep: async () => undefined,
      random: () => 0,
      transientMessageFragments: ["socket hang up", "Query was cancelled"],
    }),
  });
}

const batch = {
  tenantId: "project_abc",
  table: "event_log",
  rows: [{ TenantId: "project_abc", EventId: "event-1" }],
};

describe("ClickHouseQueryClient insert", () => {
  describe("given ClickHouse drops the connection while an insert is in flight", () => {
    describe("when the insert runs", () => {
      /** @scenario "An insert that failed after it was sent is not retried in place" */
      it("attempts it exactly once and surfaces the failure unchanged", async () => {
        const dropped = socketError("ECONNRESET", "socket hang up");
        const insert = vi.fn(async () => {
          throw dropped;
        });

        await expect(clientWith(insert).insert(batch)).rejects.toBe(dropped);
        expect(insert).toHaveBeenCalledTimes(1);
      });

      it("does not retry a cancelled query either", async () => {
        const cancelled = new Error("Query was cancelled");
        const insert = vi.fn(async () => {
          throw cancelled;
        });

        await expect(clientWith(insert).insert(batch)).rejects.toBe(cancelled);
        expect(insert).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given ClickHouse refuses the connection for the first insert attempt", () => {
    describe("when the insert runs", () => {
      /** @scenario "An insert whose connection was refused before sending is retried" */
      it("retries it and writes the batch once", async () => {
        const insert = vi
          .fn<() => Promise<void>>()
          .mockRejectedValueOnce(socketError("ECONNREFUSED", "connect ECONNREFUSED"))
          .mockResolvedValueOnce(undefined);

        await clientWith(insert).insert(batch);

        expect(insert).toHaveBeenCalledTimes(2);
      });
    });
  });
});
