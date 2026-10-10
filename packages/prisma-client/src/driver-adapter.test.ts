import { describe, expect, it } from "vitest";

import { PrismaDriverAdapterService } from "./driver-adapter.ts";

describe("PrismaDriverAdapterService", () => {
  const service = PrismaDriverAdapterService.create();

  /** @scenario "The schema URL parameter routes both model queries and raw SQL" */
  it("routes model and raw queries to the URL schema", () => {
    expect(
      service.poolConfig("postgresql://user:pass@localhost:5432/db?schema=langwatch_db"),
    ).toEqual({
      connectionString: "postgresql://user:pass@localhost:5432/db?schema=langwatch_db",
      schema: "langwatch_db",
      options: '-c search_path="langwatch_db" -c TimeZone=UTC',
    });
  });

  /** @scenario "Pool tuning URL parameters reach the pg pool" */
  it("maps Prisma pool tuning parameters onto pg", () => {
    expect(
      service.poolConfig("postgresql://localhost/db?connection_limit=7&pool_timeout=20"),
    ).toEqual({
      connectionString: "postgresql://localhost/db?connection_limit=7&pool_timeout=20",
      schema: undefined,
      options: "-c TimeZone=UTC",
      max: 7,
      connectionTimeoutMillis: 20_000,
    });
  });

  /** @scenario "Absent or invalid pool parameters leave pg defaults untouched" */
  it.each([
    "postgresql://localhost/db",
    "postgresql://localhost/db?connection_limit=nope&pool_timeout=0",
  ])("leaves pg defaults untouched for %s", (databaseUrl) => {
    expect(service.poolConfig(databaseUrl)).toEqual({
      connectionString: databaseUrl,
      schema: undefined,
      options: "-c TimeZone=UTC",
    });
  });

  /** @scenario "Every session is pinned to UTC so a written instant is stored as written" */
  it.each([
    ["postgresql://localhost/db", "-c TimeZone=UTC"],
    [
      "postgresql://localhost/db?schema=langwatch_db",
      '-c search_path="langwatch_db" -c TimeZone=UTC',
    ],
  ])("pins the session time zone to UTC for %s", (databaseUrl, options) => {
    expect(service.poolConfig(databaseUrl).options).toBe(options);
  });

  /** @scenario "A malformed DATABASE_URL defers failure to first use" */
  it("defers a malformed URL failure until the adapter is used", () => {
    expect(service.poolConfig("not a url")).toEqual({
      connectionString: "not a url",
      schema: undefined,
      options: "-c TimeZone=UTC",
    });
    expect(() => service.createOwnedAdapter("not a url")).not.toThrow();
  });
});
