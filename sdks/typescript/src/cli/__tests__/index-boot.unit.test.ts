/**
 * Invariants: .env loads before dispatch (except daemon), and the boot module
 * graph stays lazy to preserve cold start performance.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Append-only record of module eval vs config() call order (not reset per test).
 */
const bootEvents = vi.hoisted(() => [] as string[]);

const dotenvConfigMock = vi.hoisted(() =>
  vi.fn(() => {
    bootEvents.push("dotenv config() called");
    return {};
  }),
);
vi.mock("dotenv", () => ({ config: dotenvConfigMock }));

const runCliMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../daemon/dispatch", () => {
  bootEvents.push("dispatch module evaluated");
  return { runCli: runCliMock };
});

describe("the CLI boot (index.ts)", () => {
  const savedArgv = process.argv;

  beforeEach(() => {
    // index.ts runs its boot logic at import time; re-import fresh per argv.
    vi.resetModules();
    dotenvConfigMock.mockClear();
    runCliMock.mockClear();
  });

  afterEach(() => {
    process.argv = savedArgv;
  });

  const boot = (argv: string[]): Promise<unknown> => {
    process.argv = argv;
    return import("../index.js");
  };

  describe("given a normal invocation", () => {
    it("loads .env before dispatching", async () => {
      await boot(["node", "cli.js", "trace", "search"]);

      expect(dotenvConfigMock).toHaveBeenCalled();
      expect(runCliMock).toHaveBeenCalled();
      // The real ordering guarantee: config() runs before runCli() is called,
      // so dispatch sees a populated process.env.
      expect(dotenvConfigMock.mock.invocationCallOrder[0]).toBeLessThan(
        runCliMock.mock.invocationCallOrder[0]!,
      );
    });

    it("evaluates the dispatch module before config() despite the source order", async () => {
      await boot(["node", "cli.js", "trace", "search"]);

      // ES module semantics hoist every static import above the module body,
      // so dispatch's MODULE-LEVEL side effects run FIRST; only its function
      // bodies see the loaded .env. Pinned so comment and reality can't drift.
      expect(bootEvents[0]).toBe("dispatch module evaluated");
      expect(bootEvents.indexOf("dispatch module evaluated")).toBeLessThan(
        bootEvents.indexOf("dotenv config() called"),
      );
    });
  });

  describe("given the daemon-server boot (daemon start --foreground)", () => {
    it("does NOT load ~/.env", async () => {
      await boot(["node", "cli.js", "daemon", "start", "--foreground"]);

      expect(dotenvConfigMock).not.toHaveBeenCalled();
      expect(runCliMock).toHaveBeenCalled();
    });
  });
});

/**
 * Static-import graph reachable from src/cli/index.ts (source-level, not
 * runtime, to catch in-bundle boot-path regressions).
 */
const SRC_ROOT = resolve(__dirname, "..", "..");

const resolveImport = (spec: string, importer: string): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(importer), spec);
  else return null; // bare package or node builtin — not traversed

  if (base.endsWith(".js")) base = base.slice(0, -3);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

/**
 * Top-level static imports only: `import type` is skipped, dynamic
 * `import()` skipped by anchoring to line-start. `[^;]*?` stops the
 * optional `... from` clause from stealing the next statement's specifier.
 */
const STATIC_IMPORT = /^import\s+(?!type\s)(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm;

const collectBootGraph = (): { local: string[]; bare: string[] } => {
  const local = new Set<string>();
  const bare = new Set<string>();

  const walk = (file: string): void => {
    if (local.has(file)) return;
    local.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(STATIC_IMPORT)) {
      const resolved = resolveImport(spec!, file);
      if (resolved) walk(resolved);
      else bare.add(spec!);
    }
  };

  walk(join(SRC_ROOT, "cli", "index.ts"));
  return {
    local: [...local].map((f) => relative(SRC_ROOT, f)).toSorted(),
    bare: [...bare].toSorted(),
  };
};

describe("the CLI boot module graph", () => {
  const WHY =
    "The CLI's ~30ms cold start depends on this graph staying tiny: everything else " +
    "is reached through lazy import(). If you added a top-level import to a module on " +
    "the boot path, move it to a lazy import() inside the function that needs it. " +
    "If the new module genuinely belongs at boot, update this list deliberately.";

  describe("given the entrypoint's transitive static imports", () => {
    /** @scenario "The query family stays off the CLI's boot graph" */
    /** @scenario "the CLI boot graph does not change for the onboarding commands" */
    /** @scenario "The command stays off the CLI boot graph" */
    it("pins the exact set of first-party modules loaded at boot", () => {
      const { local } = collectBootGraph();

      expect(local, `Boot module graph changed. ${WHY}`).toEqual([
        "cli/compileCache.ts",
        "cli/daemon/client.ts",
        "cli/daemon/dispatch.ts",
        "cli/daemon/eligibility.ts",
        "cli/daemon/identity.ts",
        "cli/daemon/protocol.ts",
        "cli/daemon/spawn-hint.ts",
        "cli/daemon/spawn.ts",
        "cli/index.ts",
        "cli/utils/governance/config.ts",
        "cli/utils/governance/resolveEndpoint.ts",
        "internal/constants.ts",
        // dispatch wraps the in-process command in a credential holder scope
        // so the resolved key never touches the shared env. The module is a
        // few lines over node:async_hooks (no third-party deps), so its boot
        // cost is negligible; it belongs here deliberately.
        "internal/credentialContext.ts",
        // The endpoint normalizer shared with the client SDK, so the CLI and an
        // embedded SDK agree on what a configured endpoint means. Two pure
        // string functions over internal/constants.ts, which is already at
        // boot; it adds no transitive dependency.
        "internal/endpoint.ts",
        "internal/runtime.ts",
      ]);
    });

    it("loads no third-party package at boot except dotenv", () => {
      const { bare } = collectBootGraph();
      const thirdParty = bare.filter(
        (spec) => !spec.startsWith("node:") && !spec.endsWith(".json"),
      );

      expect(thirdParty, `A third-party package reached the boot path. ${WHY}`).toEqual(["dotenv"]);
    });

    it("keeps the known-heavy modules off the boot path", () => {
      const { local, bare } = collectBootGraph();
      const graph = [...local, ...bare];

      // Each of these costs real milliseconds to parse+evaluate, and each is
      // needed by only a fraction of invocations.
      const heavy = [
        "chalk",
        "commander",
        "js-yaml",
        "zod",
        "ora",
        "@langwatch/langy-contract/cards",
        "cli/program.ts",
        "cli/utils/commandCatalog.ts",
      ];

      for (const module of heavy) {
        expect(
          graph.some((entry) => entry === module || entry.startsWith(`${module}/`)),
          `"${module}" is now statically imported on the CLI boot path. ${WHY}`,
        ).toBe(false);
      }

      // No command module at all — the command tree is built lazily.
      expect(
        local.filter((f) => f.startsWith("cli/commands/")),
        `A command module reached the boot path. ${WHY}`,
      ).toEqual([]);
    });
  });
});
