/**
 * The config-store-tolerant ClickHouse statement runner (issue #8258).
 *
 * The application owns the LangWatchQL access model on every distribution and
 * provisions it at boot, but a server that already defines an LWQL entity in
 * its read-only config store (users.xml / config.xml) rejects the statement
 * that would create or alter it. This runner must skip exactly those rejections
 * (codes 495 / 669 / 670 / 671), collect them, and keep provisioning — while
 * every other error still aborts the run.
 *
 * A hand-built fake client stands in for `@clickhouse/client` here: it is a
 * boundary we do not own, and a fake throwing a real code-carrying error is the
 * honest double (no `vi.mock`).
 *
 * @see ../clickhouseStatementRunner.ts
 * @see specs/lwql/api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";

import { CLICKHOUSE_ERROR_CODE } from "../../__tests__/lwqlClickHouseHarness";
import {
  CLICKHOUSE_CONFIG_STORE_ERROR_CODE,
  runClickHouseStatements,
} from "../clickhouseStatementRunner";

/** The shape `@clickhouse/client` throws: a `code` string on the error. */
class FakeClickHouseError extends Error {
  constructor(public readonly code: string) {
    super(`Code: ${code}. DB::Exception`);
    this.name = "ClickHouseError";
  }
}

/**
 * A client that rejects the statements named in `rejections` with the given
 * code and runs everything else, recording the order it ran them in.
 */
function fakeClient({
  rejections,
  ran,
}: {
  rejections: Record<string, string>;
  ran: string[];
}): ClickHouseClient {
  return {
    async command({ query }: { query: string }) {
      const code = rejections[query];
      if (code) throw new FakeClickHouseError(code);
      ran.push(query);
      return undefined as never;
    },
  } as unknown as ClickHouseClient;
}

describe("runClickHouseStatements", () => {
  describe("when a statement's entity is owned by the config store", () => {
    // # Issue #8258
    /** @scenario "A config-store readonly error on one statement does not abort the rest" */
    it("skips the 495, 669, 670 and 671 statements, runs the rest, and reports the skips", async () => {
      const ran: string[] = [];
      const client = fakeClient({
        ran,
        rejections: {
          "CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY 's3cr3t'":
            String(CLICKHOUSE_CONFIG_STORE_ERROR_CODE.ACCESS_STORAGE_READONLY),
          "DROP NAMED COLLECTION IF EXISTS lwql_postgres": String(
            CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
          ),
          "ALTER NAMED COLLECTION lwql_postgres SET host = 'pg'": String(
            CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
          ),
          "CREATE NAMED COLLECTION lwql_postgres AS host = 'pg'": String(
            CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
          ),
        },
      });

      const statements = [
        "CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY 's3cr3t'",
        "DROP NAMED COLLECTION IF EXISTS lwql_postgres",
        "ALTER NAMED COLLECTION lwql_postgres SET host = 'pg'",
        "CREATE NAMED COLLECTION lwql_postgres AS host = 'pg'",
        "CREATE OR REPLACE VIEW langwatch.traces AS SELECT 1",
      ];

      const result = await runClickHouseStatements({
        client,
        statements,
        secrets: ["s3cr3t"],
      });

      // The one non-config-store statement still ran.
      expect(ran).toEqual(["CREATE OR REPLACE VIEW langwatch.traces AS SELECT 1"]);
      // All four config-store statements were skipped and named by code.
      expect(result.skipped.map((s) => s.code)).toEqual([
        CLICKHOUSE_ERROR_CODE.ACCESS_STORAGE_READONLY,
        CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
        CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
        CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
      ]);
      expect(result.skipped.map((s) => s.index)).toEqual([1, 2, 3, 4]);
      // The password never reaches the recorded/logged skip text.
      expect(result.skipped[0]?.statement).not.toContain("s3cr3t");
      expect(result.skipped[0]?.statement).toContain("[REDACTED]");
    });
  });

  describe("when a statement fails for any other reason", () => {
    it("rethrows and stops the run", async () => {
      const ran: string[] = [];
      const client = fakeClient({
        ran,
        rejections: {
          "GRANT SELECT ON langwatch.traces TO langwatch_lwql": String(
            CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          ),
        },
      });

      await expect(
        runClickHouseStatements({
          client,
          statements: [
            "GRANT SELECT ON langwatch.traces TO langwatch_lwql",
            "CREATE OR REPLACE VIEW langwatch.traces AS SELECT 1",
          ],
        }),
      ).rejects.toBeInstanceOf(FakeClickHouseError);

      // Aborted before the statement after the failure.
      expect(ran).toEqual([]);
    });
  });

  describe("when every statement succeeds", () => {
    it("runs them all and reports no skips", async () => {
      const ran: string[] = [];
      const client = fakeClient({ ran, rejections: {} });

      const result = await runClickHouseStatements({
        client,
        statements: ["CREATE DATABASE langwatch", "CREATE TABLE langwatch.t (a Int64) ENGINE = Memory"],
      });

      expect(result.skipped).toEqual([]);
      expect(ran).toHaveLength(2);
    });
  });
});
