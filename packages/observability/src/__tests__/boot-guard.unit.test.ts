import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { installBootGuard } from "../boot-guard.ts";

/** The crash listener the guard added, called directly so the test runner never sees a crash. */
function addedListener(
  event: "uncaughtException" | "unhandledRejection",
  before: readonly unknown[],
): (error: unknown) => void {
  const added = process.listeners(event).find((listener) => !before.includes(listener));
  if (!added) throw new Error(`the guard added no ${event} listener`);
  return (error) => Reflect.apply(added, process, [error]);
}

describe("installBootGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given an onFatal drain", () => {
    it("writes the fatal line and drains instead of exiting on an uncaught exception", () => {
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const onFatal = vi.fn();
      const before = process.listeners("uncaughtException");
      const guard = installBootGuard("langwatch-backend", { onFatal });

      try {
        addedListener("uncaughtException", before)(new Error("boom"));
      } finally {
        guard.dispose();
      }

      expect(onFatal).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();
      expect(String(write.mock.calls[0]?.[0])).toContain("uncaught exception");
    });

    it("stops listening once disposed", () => {
      const before = process.listeners("unhandledRejection").length;
      const guard = installBootGuard("langwatch-backend", { onFatal: () => undefined });

      expect(process.listeners("unhandledRejection")).toHaveLength(before + 1);
      guard.dispose();
      expect(process.listeners("unhandledRejection")).toHaveLength(before);
    });
  });

  describe("given a Node warning", () => {
    it("reports it at warn level, never as fatal", () => {
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const before = process.listeners("warning");
      const guard = installBootGuard("langwatch-backend", { onFatal: () => undefined });

      try {
        const added = process.listeners("warning").find((listener) => !before.includes(listener));
        if (!added) throw new Error("the guard added no warning listener");
        Reflect.apply(added, process, [new Error("Possible EventEmitter memory leak detected")]);
      } finally {
        guard.dispose();
      }

      expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
        level: "warn",
        msg: "warning: Possible EventEmitter memory leak detected",
      });
    });
  });

  describe("given no drain", () => {
    it("exits non-zero on an unhandled rejection", () => {
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const before = process.listeners("unhandledRejection");
      const guard = installBootGuard("langwatch-api");

      try {
        addedListener("unhandledRejection", before)(new Error("rejected"));
      } finally {
        guard.dispose();
      }

      expect(exit).toHaveBeenCalledWith(1);
    });
  });
});
