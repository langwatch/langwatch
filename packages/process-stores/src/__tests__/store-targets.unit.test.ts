/** The credential-free targets the stores hand out, and when they answer "not configured". */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

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

  describe("when a read carries query parameters", () => {
    /** ClickHouse logs each request's URL at trace level; a parameter there reaches its logs. */
    it("sends them in the request body, never the URL", async () => {
      const seen: { url: string; body: string }[] = [];
      const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          seen.push({ url: request.url ?? "", body: Buffer.concat(chunks).toString() });
          response.end("");
        });
      });
      await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
      const { port } = server.address() as AddressInfo;
      const built = buildClickHouseAdmin({ url: `http://admin:admin@127.0.0.1:${port}/langwatch` });
      if (!built.value.configured || built.value.statements === null) {
        throw new Error("the admin member holds no statements");
      }

      await built.value.statements.rows("SELECT {password:String}", { password: "param-secret" });

      expect(seen).toEqual([
        { url: expect.not.stringContaining("param-secret"), body: expect.any(String) },
      ]);
      expect(seen[0]?.body).toContain("param-secret");
      await built.close?.();
      server.close();
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

  describe("when there is no CLICKHOUSE_URL and the reader's URL names a server and database", () => {
    /** @scenario "A process without CLICKHOUSE_URL takes the LangWatchQL server from the reader's URL and sends nothing" */
    it("answers the reader's target with no statements and opens no client", () => {
      const built = buildClickHouseAdmin({
        readerUrl: "http://langwatch_app_reader:reader-secret@clickhouse:8123/langwatch?x=1",
      });

      expect(built.value).toEqual({
        configured: true,
        target: { url: "http://clickhouse:8123/", database: "langwatch" },
        statements: null,
      });
      expect(JSON.stringify(built.value)).not.toContain("reader-secret");
      expect(built.close).toBeUndefined();
    });

    it("keeps CLICKHOUSE_URL's target and statements when both are given", async () => {
      const built = buildClickHouseAdmin({
        url: "http://admin:admin-secret@system-host:8123/langwatch",
        readerUrl: "http://langwatch_app_reader:reader-secret@reader-host:8123/langwatch",
      });

      expect(built.value).toMatchObject({
        configured: true,
        target: { url: "http://system-host:8123/", database: "langwatch" },
        statements: expect.any(Object),
      });
      await built.close?.();
    });

    it("never falls back to the reader where CLICKHOUSE_URL is set but names no database", () => {
      const built = buildClickHouseAdmin({
        url: "http://clickhouse:8123/",
        readerUrl: "http://langwatch_app_reader:reader-secret@clickhouse:8123/langwatch",
      });

      expect(built.value).toEqual({ configured: false });
    });
  });

  describe("when there is no CLICKHOUSE_URL and the reader's URL names no database", () => {
    /** @scenario "A process given neither CLICKHOUSE_URL nor a reader URL with a database names no LangWatchQL server" */
    it("answers not configured", () => {
      const built = buildClickHouseAdmin({ readerUrl: "http://reader:secret@clickhouse:8123/" });

      expect(built.value).toEqual({ configured: false });
    });
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
