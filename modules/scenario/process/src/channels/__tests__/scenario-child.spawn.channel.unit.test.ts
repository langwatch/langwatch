/**
 * @vitest-environment node
 *
 * Unit tests for child process spawn resolution.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScenarioChildSpawn } from "../scenario-child.spawn.channel.ts";

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

/**
 * Vitest's resolver finds a workspace tsx from any anchor, so the real
 * `createRequire` cannot stand in for "not installed". This mock is the
 * package lookup the resolver calls; the spawn module itself stays real.
 */
const resolveFromPackage = vi.hoisted(() => vi.fn());
const createRequire = vi.hoisted(() => vi.fn(() => ({ resolve: resolveFromPackage })));

vi.mock("node:module", () => ({
  createRequire,
}));

// Mock fs.existsSync to control bundle presence
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fsModule>();
  return {
    default: {
      ...actual,
      existsSync: vi.fn(),
      statSync: vi.fn(),
      // Mocked too, or the freshness scan walks the REAL tree at the paths
      // below — which do not exist, so `readdirSync` throws, the check's
      // catch answers "not fresh", and the bundle branch can never be
      // reached however the mtimes are arranged.
      readdirSync: vi.fn(),
    },
  };
});

// Mock the logger so we can assert on log calls
vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
  // The package index reaches @langwatch/api/trpc, whose call logging builds
  // one of these at module load. Mocking the logger has to mock it too.
  createWarnThrottle: () => ({ claim: () => 0 }),
}));

import fs from "fs";
import type * as fsModule from "fs";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_PATH = path.join(PACKAGE_ROOT, "src", "main.ts");
const BUNDLE = path.join(PACKAGE_ROOT, "dist", "server", "scenario-child-process.mjs");
const SECRET = "scenario-child-env-sentinel";
const MISSING_TSX =
  "Scenario child bundle is missing and tsx is unavailable. Run `pnpm install` or `pnpm --filter @langwatch/scenario-child build`.";
const STALE_TSX =
  "Scenario child bundle is stale and tsx is unavailable. Run `pnpm install` or `pnpm --filter @langwatch/scenario-child build`.";

function spawnOptions(nodeEnv: string | undefined) {
  return {
    packageRoot: PACKAGE_ROOT,
    nodeEnv,
    sourcePath: SOURCE_PATH,
    sourceRoots: [path.dirname(SOURCE_PATH)],
  };
}

function tsxResolves(): void {
  resolveFromPackage.mockReturnValue(path.join(PACKAGE_ROOT, "node_modules", "tsx", "index.js"));
}

function tsxDoesNotResolve(): Error {
  const cause = new Error("Cannot find module 'tsx'");
  resolveFromPackage.mockImplementation(() => {
    throw cause;
  });
  return cause;
}

describe("ScenarioChildSpawn.resolve", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.readdirSync).mockReset();
    mockLogger.info.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.error.mockReset();
    createRequire.mockReset();
    createRequire.mockImplementation(() => ({ resolve: resolveFromPackage }));
    resolveFromPackage.mockReset();
    tsxResolves();
    vi.stubEnv("LANGWATCH_API_KEY", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("when NODE_ENV is production", () => {
    describe("when pre-compiled bundle exists", () => {
      beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
      });

      /** @scenario 'Processor spawns child process using the pre-compiled bundle in production' */
      it("invokes node with the path to the compiled bundle", () => {
        // A newer source and no installed tsx must not leave the bundle path.
        tsxDoesNotResolve();
        vi.mocked(fs.readdirSync).mockReturnValue([
          { name: "child.ts", isDirectory: () => false },
        ] as never);
        vi.mocked(fs.statSync).mockImplementation((target) => {
          if (target === BUNDLE) return { mtimeMs: 1000 } as fs.Stats;
          return { mtimeMs: 2000 } as fs.Stats;
        });

        const result = ScenarioChildSpawn.create().resolve(spawnOptions("production"));

        expect(result.command).toBe("node");
        expect(result.args).toEqual([BUNDLE]);
        expect(createRequire).not.toHaveBeenCalled();
      });

      it("does not invoke pnpm exec tsx", () => {
        const result = ScenarioChildSpawn.create().resolve(spawnOptions("production"));

        expect(result.command).not.toBe("pnpm");
        expect(result.args).not.toContain("tsx");
      });

      it("logs the bundle path at info level", () => {
        ScenarioChildSpawn.create().resolve(spawnOptions("production"));

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            bundlePath: expect.stringContaining("dist/server/scenario-child-process.mjs"),
          }),
          expect.stringContaining("pre-compiled bundle"),
        );
      });
    });

    describe("when pre-compiled bundle does not exist", () => {
      beforeEach(() => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
      });

      /** @scenario "Processor fails loudly when the bundle is missing in production" */
      it("throws instead of falling back to pnpm exec tsx", () => {
        expect(() => ScenarioChildSpawn.create().resolve(spawnOptions("production"))).toThrow(
          /NOT FOUND/,
        );
        expect(createRequire).not.toHaveBeenCalled();
      });

      it("logs an error with the missing bundle path", () => {
        expect(() => ScenarioChildSpawn.create().resolve(spawnOptions("production"))).toThrow(
          /NOT FOUND/,
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ bundlePath: BUNDLE }),
          expect.stringContaining("build:server"),
        );
      });
    });
  });

  describe("when NODE_ENV is development", () => {
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
      // One child source in the scanned root, so `hasFileNewerThan` compares
      // exactly one mtime against the bundle's.
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: "child.ts", isDirectory: () => false },
      ] as never);
      vi.mocked(fs.statSync).mockImplementation((target) => {
        if (target === BUNDLE) {
          if (bundleMtimeMs === undefined) throw new Error("ENOENT");
          return { mtimeMs: bundleMtimeMs } as fs.Stats;
        }
        return { mtimeMs: sourceMtimeMs } as fs.Stats;
      });
    };

    it("invokes node with the bundle when it is newer than every child source", () => {
      tsxDoesNotResolve();
      givenMtimes({ bundleMtimeMs: 2000, sourceMtimeMs: 1000 });

      const result = ScenarioChildSpawn.create().resolve(spawnOptions("development"));

      expect(result.command).toBe("node");
      expect(result.args).toEqual([BUNDLE]);
      expect(createRequire).not.toHaveBeenCalled();
    });

    it("falls back to tsx when a child source is newer than the bundle", () => {
      // The point of the fallback: an edit takes effect on the next spawn and
      // never silently runs the previously built code.
      givenMtimes({ bundleMtimeMs: 1000, sourceMtimeMs: 2000 });

      expect(ScenarioChildSpawn.create().resolve(spawnOptions("development"))).toEqual({
        command: "pnpm",
        args: ["exec", "tsx", SOURCE_PATH],
      });
    });

    /** @scenario 'Processor spawns child process using tsx in development' */
    it("invokes pnpm exec tsx with the TypeScript source file", () => {
      givenMtimes({ sourceMtimeMs: 1000 });
      const result = ScenarioChildSpawn.create().resolve(spawnOptions("development"));

      expect(result.command).toBe("pnpm");
      expect(result.args).toEqual(["exec", "tsx", SOURCE_PATH]);
    });

    it("logs the environment at debug level", () => {
      givenMtimes({ sourceMtimeMs: 1000 });
      ScenarioChildSpawn.create().resolve(spawnOptions("development"));

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ nodeEnv: "development" }),
        expect.stringContaining("tsx"),
      );
    });

    /** @scenario "Missing tsx fails before spawn when the bundle is missing" */
    it("names a missing bundle when tsx does not resolve", () => {
      givenMtimes({ sourceMtimeMs: 1000 });
      const cause = tsxDoesNotResolve();

      expect(() => ScenarioChildSpawn.create().resolve(spawnOptions("development"))).toThrow(
        MISSING_TSX,
      );
      expect(JSON.stringify(mockLogger.error.mock.calls)).not.toContain(SECRET);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ bundleState: "missing", err: cause }),
        MISSING_TSX,
      );
    });

    /** @scenario "Missing tsx fails before spawn when the bundle is stale" */
    it("names a stale bundle when tsx does not resolve", () => {
      givenMtimes({ bundleMtimeMs: 1000, sourceMtimeMs: 2000 });
      const cause = tsxDoesNotResolve();

      let thrown: Error | undefined;
      try {
        ScenarioChildSpawn.create().resolve(spawnOptions("development"));
      } catch (error) {
        thrown = error instanceof Error ? error : undefined;
      }

      expect(thrown?.message).toBe(STALE_TSX);
      expect(thrown?.message).not.toContain(SECRET);
      expect(thrown?.cause).toBe(cause);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ bundleState: "stale", err: cause }),
        STALE_TSX,
      );
    });
  });

  describe("when NODE_ENV is test", () => {
    it("falls back to development mode (tsx)", () => {
      const result = ScenarioChildSpawn.create().resolve(spawnOptions("test"));

      expect(result.command).toBe("pnpm");
      expect(result.args).toEqual(["exec", "tsx", SOURCE_PATH]);
    });
  });

  describe("when NODE_ENV is undefined", () => {
    it("falls back to development mode (tsx)", () => {
      const result = ScenarioChildSpawn.create().resolve(spawnOptions(undefined));

      expect(result.command).toBe("pnpm");
      expect(result.args).toEqual(["exec", "tsx", SOURCE_PATH]);
    });
  });
});
