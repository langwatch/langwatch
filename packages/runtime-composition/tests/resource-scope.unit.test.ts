import { describe, expect, it, vi } from "vitest";
import { ResourceScope } from "../src";

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

  it("shares one in-flight close and rejects resources registered after close", async () => {
    let finishClose: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const closeResource = vi.fn(async () => waiting);
    const scope = new ResourceScope();
    scope.own("worker", closeResource);

    const first = scope.close();
    const second = scope.close();

    expect(second).toBe(first);
    expect(() => scope.own("late", () => undefined)).toThrow("scope is closed");
    finishClose?.();
    await first;
    expect(closeResource).toHaveBeenCalledOnce();
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
