/**
 * @vitest-environment node
 *
 * Unit tests for child process spawn resolution.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "path";
import { resolveChildProcessSpawn } from "../child-process-spawn";

// vi.hoisted runs before vi.mock hoisting, so mockLogger is available in the factory
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
}));

// Mock fs.existsSync to control bundle presence
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
}));

// Mock the logger so we can assert on log calls
vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import fs from "fs";

const PACKAGE_ROOT = "/app/langwatch";

describe("resolveChildProcessSpawn", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    mockLogger.info.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.error.mockReset();
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

      it("logs the bundle path at info level", () => {
        resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            bundlePath: expect.stringContaining("dist/scenario-child-process.js"),
          }),
          expect.stringContaining("pre-compiled bundle"),
        );
      });
    });

    describe("when pre-compiled bundle does not exist", () => {
      beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
      });

      it("falls back to tsx instead of crashing", () => {
        const result = resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(result.command).toBe("pnpm");
        expect(result.args[0]).toBe("exec");
        expect(result.args[1]).toBe("tsx");
      });

      it("logs an error with the missing bundle path", () => {
        resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            bundlePath: expect.stringContaining(
              path.join(PACKAGE_ROOT, "dist", "scenario-child-process.js"),
            ),
          }),
          expect.stringContaining("NOT FOUND"),
        );
      });

      it("logs a remediation hint in the error message", () => {
        resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringContaining("build:scenario-child-process"),
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

    it("logs the environment at debug level", () => {
      resolveChildProcessSpawn({
        packageRoot: PACKAGE_ROOT,
        nodeEnv: "development",
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ nodeEnv: "development" }),
        expect.stringContaining("tsx"),
      );
    });
  });

  describe("when NODE_ENV is test", () => {
    it("falls back to development mode (tsx)", () => {
      const result = resolveChildProcessSpawn({
        packageRoot: PACKAGE_ROOT,
        nodeEnv: "test",
      });

      expect(result.command).toBe("pnpm");
      expect(result.args[0]).toBe("exec");
      expect(result.args[1]).toBe("tsx");
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
