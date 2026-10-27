import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseOverloadErrorFactory } from "../managed-client.ts";
import type { QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

const request: QueryRequest = {
  tenantId: "project_abc",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_abc" },
};

class Overloaded extends Error {
  constructor(readonly cause: unknown) {
    super("clickhouse_overloaded");
  }
}

class OverloadFactory extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return new Overloaded(cause);
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
    overloadErrorFactory: new OverloadFactory(),
  });

describe("ClickHouseQueryClient", () => {
  describe("given a server that refuses the read as too many simultaneous queries", () => {
    /** @scenario "A read the ClickHouse server refuses as too many simultaneous queries is refused as clickhouse_overloaded" */
    it("refuses the read with the overload refusal, keeping the server's refusal", async () => {
      const refused = Object.assign(new Error("Too many simultaneous queries. Maximum: 100."), {
        code: "202",
      });

      const failure = await clientFailingWith(refused)
        .query(request)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Overloaded);
      expect((failure as Overloaded).cause).toBe(refused);
    });
  });

  describe("given another server error", () => {
    /** @scenario "A read the ClickHouse server refuses as too many simultaneous queries is refused as clickhouse_overloaded" */
    it("passes it through unchanged", async () => {
      const serverError = Object.assign(new Error("Code: 60. UNKNOWN_TABLE"), { code: "60" });

      await expect(clientFailingWith(serverError).query(request)).rejects.toBe(serverError);
    });
  });
});
