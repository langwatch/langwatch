/**
 * @vitest-environment node
 *
 * Unit tests for child process spawn resolution.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import { resolveChildProcessSpawn } from "../child-process-spawn";

// Mock fs.existsSync to control bundle presence
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
}));

import fs from "fs";

const PACKAGE_ROOT = "/app/langwatch";

describe("resolveChildProcessSpawn", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when NODE_ENV is production", () => {
    describe("when pre-compiled bundle exists", () => {
      beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
      });

      it("invokes node with the path to the compiled bundle", () => {
        const result = resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(result.command).toBe("node");
        expect(result.args).toEqual([
          path.join(PACKAGE_ROOT, "dist", "scenario-child-process.js"),
        ]);
      });

      it("does not invoke pnpm exec tsx", () => {
        const result = resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(result.command).not.toBe("pnpm");
        expect(result.args).not.toContain("tsx");
      });
    });

    describe("when pre-compiled bundle does not exist", () => {
      beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
      });

      it("fails with a descriptive error indicating the bundle is missing", () => {
        expect(() =>
          resolveChildProcessSpawn({
            packageRoot: PACKAGE_ROOT,
            nodeEnv: "production",
          }),
        ).toThrow(/Pre-compiled scenario child process bundle not found/);
      });

      it("includes the expected bundle path in the error message", () => {
        expect(() =>
          resolveChildProcessSpawn({
            packageRoot: PACKAGE_ROOT,
            nodeEnv: "production",
          }),
        ).toThrow(
          path.join(PACKAGE_ROOT, "dist", "scenario-child-process.js"),
        );
      });
    });
  });

  describe("when NODE_ENV is development", () => {
    it("invokes pnpm exec tsx with the TypeScript source file", () => {
      const result = resolveChildProcessSpawn({
        packageRoot: PACKAGE_ROOT,
        nodeEnv: "development",
      });

      expect(result.command).toBe("pnpm");
      expect(result.args).toEqual([
        "exec",
        "tsx",
        path.join(
          PACKAGE_ROOT,
          "src",
          "server",
          "scenarios",
          "execution",
          "scenario-child-process.ts",
        ),
      ]);
    });
  });

  describe("when NODE_ENV is undefined", () => {
    it("falls back to development mode (tsx)", () => {
      const result = resolveChildProcessSpawn({
        packageRoot: PACKAGE_ROOT,
        nodeEnv: undefined,
      });

      expect(result.command).toBe("pnpm");
      expect(result.args[0]).toBe("exec");
      expect(result.args[1]).toBe("tsx");
    });
  });
});
