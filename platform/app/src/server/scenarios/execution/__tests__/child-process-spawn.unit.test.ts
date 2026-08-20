/**
 * @vitest-environment node
 *
 * Unit tests for child process spawn resolution.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    statSync: vi.fn(),
    readdirSync: vi.fn(),
  },
}));

// Mock the logger so we can assert on log calls
vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import fs from "fs";

const PACKAGE_ROOT = "/app/platform/app";

describe("resolveChildProcessSpawn", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
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

      /** @scenario 'Processor spawns child process using the pre-compiled bundle in production' */
      it("invokes node with the path to the compiled bundle", () => {
        const result = resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "production",
        });

        expect(result.command).toBe("node");
        expect(result.args).toEqual([
          path.join(
            PACKAGE_ROOT,
            "dist",
            "server",
            "scenario-child-process.cjs",
          ),
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
            bundlePath: expect.stringContaining(
              "dist/server/scenario-child-process.cjs",
            ),
          }),
          expect.stringContaining("pre-compiled bundle"),
        );
      });
    });

    describe("when pre-compiled bundle does not exist", () => {
      beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
      });

      /** @scenario 'Processor falls back to tsx with loud logging when bundle is missing in production' */
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
              path.join(
                PACKAGE_ROOT,
                "dist",
                "server",
                "scenario-child-process.cjs",
              ),
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
          expect.stringContaining("build:server"),
        );
      });
    });
  });

  describe("when NODE_ENV is development", () => {
    const BUNDLE = path.join(
      PACKAGE_ROOT,
      "dist",
      "server",
      "scenario-child-process.cjs",
    );

    /**
     * Bundle at `bundleMtimeMs`, one child source at `sourceMtimeMs`. Omitting
     * the bundle mtime makes statSync throw for it, standing in for "not built".
     */
    const givenMtimes = ({
      bundleMtimeMs,
      sourceMtimeMs,
    }: {
      bundleMtimeMs?: number;
      sourceMtimeMs: number;
    }) => {
      vi.mocked(fs.statSync).mockImplementation(((target: string) => {
        if (target === BUNDLE) {
          if (bundleMtimeMs === undefined) throw new Error("ENOENT");
          return { mtimeMs: bundleMtimeMs };
        }
        return { mtimeMs: sourceMtimeMs };
      }) as unknown as typeof fs.statSync);
      vi.mocked(fs.readdirSync).mockImplementation((() => [
        { name: "scenario-child-process.ts", isDirectory: () => false },
      ]) as unknown as typeof fs.readdirSync);
    };

    it("invokes node with the bundle when it is newer than every child source", () => {
      givenMtimes({ bundleMtimeMs: 2000, sourceMtimeMs: 1000 });

      const result = resolveChildProcessSpawn({
        packageRoot: PACKAGE_ROOT,
        nodeEnv: "development",
      });

      expect(result.command).toBe("node");
      expect(result.args).toEqual([BUNDLE]);
    });

    it("falls back to tsx when a child source is newer than the bundle", () => {
      // The point of the fallback: an edit takes effect on the next spawn and
      // never silently runs the previously built code.
      givenMtimes({ bundleMtimeMs: 1000, sourceMtimeMs: 2000 });

      expect(
        resolveChildProcessSpawn({
          packageRoot: PACKAGE_ROOT,
          nodeEnv: "development",
        }).command,
      ).toBe("pnpm");
    });

    /** @scenario 'Processor spawns child process using tsx in development' */
    it("invokes pnpm exec tsx with the TypeScript source file", () => {
      givenMtimes({ sourceMtimeMs: 1000 });
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
