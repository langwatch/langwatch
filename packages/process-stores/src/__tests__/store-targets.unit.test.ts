/** The credential-free targets the stores hand out, and when they answer "not configured". */
import { describe, expect, it } from "vitest";

import { buildClickHouseAdmin, buildDatabaseTarget } from "../store-targets.ts";

describe("given the stores' ClickHouse admin member", () => {
  describe("when CLICKHOUSE_URL names a server and database", () => {
    it("answers the target with credentials and path stripped", async () => {
      const built = buildClickHouseAdmin({
        url: "http://admin:admin-secret@clickhouse:8123/langwatch",
      });

      expect(built.value).toMatchObject({
        configured: true,
        target: { url: "http://clickhouse:8123/", database: "langwatch" },
      });
      expect(JSON.stringify(built.value)).not.toContain("admin-secret");
      await built.close?.();
    });
  });

  describe("when the URL is absent, unparsable or names no database", () => {
    it.each([undefined, "", "not a url", "http://clickhouse:8123/"])(
      "answers not configured for %j, never a throw",
      (url) => {
        const built = buildClickHouseAdmin(url === undefined ? undefined : { url });
        expect(built.value).toEqual({ configured: false });
        expect(built.close).toBeUndefined();
      },
    );
  });
});

describe("given the stores' database target member", () => {
  it("answers host, port, database, schema and pool size without credentials", () => {
    expect(
      buildDatabaseTarget({
        url: "postgresql://app:app-secret@pg:6543/langwatch?schema=langwatch_db&connection_limit=5",
      }).value,
    ).toEqual({
      configured: true,
      host: "pg",
      port: 6543,
      database: "langwatch",
      schema: "langwatch_db",
      connectionLimit: 5,
    });
  });

  it("answers not configured where DATABASE_URL is absent", () => {
    expect(buildDatabaseTarget(undefined).value).toEqual({ configured: false });
  });
});
