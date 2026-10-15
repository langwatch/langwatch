// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const environmentReads: string[] = [];
const realEnvironment = process.env;
const intervals = vi.spyOn(globalThis, "setInterval");

/** A read counts when workspace source made it: the frame that touched the variable. */
function isWorkspaceRead(stack: string): boolean {
  const caller = stack.split("\n")[3] ?? "";
  return (
    /\/(enterprise|modules|packages)\//.test(caller) &&
    !caller.includes("node_modules") &&
    !caller.includes("node:")
  );
}

function recordRead(key: string | symbol): void {
  if (typeof key === "string" && isWorkspaceRead(new Error().stack ?? "")) {
    environmentReads.push(key);
  }
}

beforeAll(() => {
  process.env = new Proxy(realEnvironment, {
    get(target, key, receiver) {
      recordRead(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      recordRead(key);
      return Reflect.has(target, key);
    },
  });
});

afterAll(() => {
  process.env = realEnvironment;
  intervals.mockRestore();
});

describe("given a runtime that imports the licensing packages", () => {
  describe("when the contract and the server package are loaded fresh", () => {
    /** @scenario "Import licensing without side effects" */
    it("reads no environment and schedules no job", async () => {
      vi.resetModules();

      const contract = await import("@langwatch/enterprise-licensing-contract");
      const server = await import("../index.ts");

      expect(Object.keys(contract).length).toBeGreaterThan(0);
      expect(server.licensingProcessModule).toBeDefined();
      expect(environmentReads).toEqual([]);
      expect(intervals).not.toHaveBeenCalled();
    }, 120_000);
  });
});
