import { describe, expect, it } from "vitest";
import { PrismaDriverAdapterService } from "./driver-adapter";

describe("PrismaDriverAdapterService", () => {
  const service = PrismaDriverAdapterService.create();

  it("routes model and raw queries to the URL schema", () => {
    expect(
      service.poolConfig("postgresql://user:pass@localhost:5432/db?schema=langwatch_db"),
    ).toEqual({
      connectionString: "postgresql://user:pass@localhost:5432/db?schema=langwatch_db",
      schema: "langwatch_db",
      options: '-c search_path="langwatch_db"',
    });
  });

  it("maps Prisma pool tuning parameters onto pg", () => {
    expect(
      service.poolConfig("postgresql://localhost/db?connection_limit=7&pool_timeout=20"),
    ).toEqual({
      connectionString: "postgresql://localhost/db?connection_limit=7&pool_timeout=20",
      schema: undefined,
      max: 7,
      connectionTimeoutMillis: 20_000,
    });
  });

  it.each([
    "postgresql://localhost/db",
    "postgresql://localhost/db?connection_limit=nope&pool_timeout=0",
  ])("leaves pg defaults untouched for %s", (databaseUrl) => {
    expect(service.poolConfig(databaseUrl)).toEqual({
      connectionString: databaseUrl,
      schema: undefined,
    });
  });

  it("defers a malformed URL failure until the adapter is used", () => {
    expect(service.poolConfig("not a url")).toEqual({
      connectionString: "not a url",
      schema: undefined,
    });
    expect(() => service.createOwnedAdapter("not a url")).not.toThrow();
  });
});
