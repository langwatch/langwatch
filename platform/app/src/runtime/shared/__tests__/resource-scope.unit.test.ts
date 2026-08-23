import { describe, expect, it, vi } from "vitest";
import { ResourceScope } from "../resource-scope";

describe("ResourceScope", () => {
  /** @scenario Combined shutdown drains work before closing shared clients */
  it("closes resources once in reverse ownership order", async () => {
    const calls: string[] = [];
    const scope = new ResourceScope();
    scope.own("database", () => {
      calls.push("database");
    });
    scope.own("worker", () => {
      calls.push("worker");
    });

    await scope.close();
    await scope.close();

    expect(calls).toEqual(["worker", "database"]);
  });

  it("collects close failures without skipping older resources", async () => {
    const closeDatabase = vi.fn();
    const scope = new ResourceScope();
    scope.own("database", closeDatabase);
    scope.own("worker", () => {
      throw new Error("drain failed");
    });

    await expect(scope.close()).rejects.toThrow("worker");
    expect(closeDatabase).toHaveBeenCalledOnce();
  });
});
