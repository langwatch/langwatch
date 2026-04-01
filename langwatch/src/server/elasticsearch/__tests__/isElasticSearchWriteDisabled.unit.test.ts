import { describe, expect, it } from "vitest";
import {
  isElasticSearchWriteDisabled,
} from "../isElasticSearchWriteDisabled";

describe("isElasticSearchWriteDisabled()", () => {
  it("always returns true (ES writes globally disabled)", async () => {
    const prisma = {} as any;
    expect(await isElasticSearchWriteDisabled(prisma, "any-project", "traces")).toBe(true);
    expect(await isElasticSearchWriteDisabled(prisma, "any-project", "evaluations")).toBe(true);
    expect(await isElasticSearchWriteDisabled(prisma, "any-project", "simulations")).toBe(true);
  });
});
