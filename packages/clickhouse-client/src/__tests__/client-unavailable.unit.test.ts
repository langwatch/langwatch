import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient, ClickHouseUnavailableErrorFactory } from "../client.ts";
import type { QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

const request: QueryRequest = {
  tenantId: "project_abc",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_abc" },
};

class Refused extends Error {
  constructor(readonly cause: Error) {
    super("clickhouse_unavailable");
  }
}

class RefusalFactory extends ClickHouseUnavailableErrorFactory {
  create({ cause }: { cause: Error }): unknown {
    return new Refused(cause);
  }
}

const unused = async (): Promise<never> => {
  throw new Error("not part of this case");
};

const clientFailingWith = (failure: Error) =>
  new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: {
      execute: async () => {
        throw failure;
      },
      insert: unused,
      command: unused,
    },
    unavailableErrorFactory: new RefusalFactory(),
  });

describe("ClickHouseQueryClient", () => {
  describe("given a server that drops the connection", () => {
    /** @scenario "A read whose ClickHouse stops answering is refused as clickhouse_unavailable" */
    it("refuses the read with the unavailable refusal, keeping the dropped connection", async () => {
      const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });

      const failure = await clientFailingWith(reset)
        .query(request)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Refused);
      expect((failure as Refused).cause).toBe(reset);
    });
  });

  describe("given a server error", () => {
    it("passes it through unchanged", async () => {
      const serverError = Object.assign(new Error("Code: 60. UNKNOWN_TABLE"), { code: "60" });

      await expect(clientFailingWith(serverError).query(request)).rejects.toBe(serverError);
    });
  });
});
