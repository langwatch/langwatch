/**
 * @vitest-environment node
 *
 * Unit tests for child process spawn resolution.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveChildProcessSpawn } from "../src";

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
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    default: {
      ...actual,
      existsSync: vi.fn(),
      statSync: vi.fn(),
    },
  };
});

// Mock the logger so we can assert on log calls
vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import fs from "fs";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../../../../platform/app");
const SOURCE_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "runtime",
  "worker",
  "scenario-child-process.ts",
);
const SOURCE_ROOTS = [path.dirname(SOURCE_PATH)];

function spawnOptions(nodeEnv: string | undefined) {
  return {
    packageRoot: PACKAGE_ROOT,
    nodeEnv,
    sourcePath: SOURCE_PATH,
    sourceRoots: SOURCE_ROOTS,
  };
}

describe("resolveChildProcessSpawn", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.statSync).mockReset();
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
        const result = resolveChildProcessSpawn(spawnOptions("production"));

        expect(result.command).toBe("node");
        expect(result.args).toEqual([
          path.join(PACKAGE_ROOT, "dist", "server", "scenario-child-process.cjs"),
        ]);
      });

      it("does not invoke pnpm exec tsx", () => {
        const result = resolveChildProcessSpawn(spawnOptions("production"));

        expect(result.command).not.toBe("pnpm");
        expect(result.args).not.toContain("tsx");
      });

      it("logs the bundle path at info level", () => {
        resolveChildProcessSpawn(spawnOptions("production"));

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            bundlePath: expect.stringContaining("dist/server/scenario-child-process.cjs"),
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
        const result = resolveChildProcessSpawn(spawnOptions("production"));

        expect(result.command).toBe("pnpm");
        expect(result.args[0]).toBe("exec");
        expect(result.args[1]).toBe("tsx");
      });

      it("logs an error with the missing bundle path", () => {
        resolveChildProcessSpawn(spawnOptions("production"));

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({
            bundlePath: expect.stringContaining(
              path.join(PACKAGE_ROOT, "dist", "server", "scenario-child-process.cjs"),
            ),
          }),
          expect.stringContaining("NOT FOUND"),
        );
      });

      it("logs a remediation hint in the error message", () => {
        resolveChildProcessSpawn(spawnOptions("production"));

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
      vi.mocked(fs.statSync).mockImplementation((target) => {
        if (target === BUNDLE) {
          if (bundleMtimeMs === undefined) throw new Error("ENOENT");
          return { mtimeMs: bundleMtimeMs } as fs.Stats;
        }
        return { mtimeMs: sourceMtimeMs } as fs.Stats;
      });
    };

    it("invokes node with the bundle when it is newer than every child source", () => {
      givenMtimes({ bundleMtimeMs: 2000, sourceMtimeMs: 1000 });

      const result = resolveChildProcessSpawn(spawnOptions("development"));

      expect(result.command).toBe("node");
      expect(result.args).toEqual([BUNDLE]);
    });

    it("falls back to tsx when a child source is newer than the bundle", () => {
      // The point of the fallback: an edit takes effect on the next spawn and
      // never silently runs the previously built code.
      givenMtimes({ bundleMtimeMs: 1000, sourceMtimeMs: 2000 });

      expect(resolveChildProcessSpawn(spawnOptions("development")).command).toBe("pnpm");
    });

    /** @scenario 'Processor spawns child process using tsx in development' */
    it("invokes pnpm exec tsx with the TypeScript source file", () => {
      givenMtimes({ sourceMtimeMs: 1000 });
      const result = resolveChildProcessSpawn(spawnOptions("development"));

      expect(result.command).toBe("pnpm");
      expect(result.args).toEqual(["exec", "tsx", SOURCE_PATH]);
    });

    it("logs the environment at debug level", () => {
      resolveChildProcessSpawn(spawnOptions("development"));

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ nodeEnv: "development" }),
        expect.stringContaining("tsx"),
      );
    });
  });

  describe("when NODE_ENV is test", () => {
    it("falls back to development mode (tsx)", () => {
      const result = resolveChildProcessSpawn(spawnOptions("test"));

      expect(result.command).toBe("pnpm");
      expect(result.args[0]).toBe("exec");
      expect(result.args[1]).toBe("tsx");
    });
  });

  describe("when NODE_ENV is undefined", () => {
    it("falls back to development mode (tsx)", () => {
      const result = resolveChildProcessSpawn(spawnOptions(undefined));

      expect(result.command).toBe("pnpm");
      expect(result.args[0]).toBe("exec");
      expect(result.args[1]).toBe("tsx");
    });
  });
});
