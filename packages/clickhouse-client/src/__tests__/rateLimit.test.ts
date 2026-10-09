import { describe, expect, it, vi } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
} from "../managed-client.ts";

class SilentTelemetry extends ClickHouseManagedClientTelemetry {
  registerLimiter(): void {}
  unregisterLimiter(): void {}
  observeStatementWait(): void {}
  incrementStatementsShed(): void {}
}

class PlainOverload extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return cause;
  }
}

describe("a statement bound driving a client", () => {
  describe("given a statement", () => {
    describe("when it is executed", () => {
      it("runs it through the bound and releases the slot", async () => {
        const limiter = new ClickHouseStatementAdmission({
          instance: "test",
          maxConcurrent: 1,
          telemetry: new SilentTelemetry(),
          overloadErrorFactory: new PlainOverload(),
        });
        const execute = vi.fn(async () => ({ rows: [1] }));
        const client = new ClickHouseQueryClient({
          driver: { execute } as never,
          limiter,
        });

        const result = await client.query({
          tenantId: "project_1",
          sql: "SELECT 1",
        });

        expect(result.rows).toEqual([1]);
        expect(limiter.stats().inFlight).toBe(0);
      });
    });
  });
});
