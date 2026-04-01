import { describe, expect, it } from "vitest";
import { isClickHouseReadEnabled } from "../isClickHouseReadEnabled";

describe("isClickHouseReadEnabled", () => {
  it("always returns true (ClickHouse is the primary data source)", async () => {
    const prisma = {} as any;
    expect(await isClickHouseReadEnabled(prisma, "any-project")).toBe(true);
  });
});
