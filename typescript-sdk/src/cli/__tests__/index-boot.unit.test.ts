/**
 * Two invariants of the CLI entrypoint.
 *
 * 1. .env loading. The entrypoint loads .env before dispatching — except when
 *    the process being booted IS the daemon server. That boot runs with
 *    cwd=$HOME (daemon/spawn.ts), and its process env becomes the baseline
 *    every request resets to, so loading ~/.env there would drop
 *    home-directory secrets into every caller's execution window.
 *
 * 2. The boot module graph. The CLI's ~30ms cold start exists ONLY because
 *    commander, chalk, zod, js-yaml, the command modules and the command
 *    catalog are reached through lazy `import()`, never a top-level `import`.
 *    Nothing about that is enforced by the type system: a single innocuous
 *    `import { something } from "../utils/output"` added to a module on the
 *    boot path drags its whole transitive graph into every invocation, and no
 *    test fails. The graph guard below pins the set so it fails loudly.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Append-only across the whole file — never cleared. It records when the
 * dispatch MODULE is evaluated relative to when dotenv's config() is CALLED,
 * which is the ordering that actually matters and the one the entrypoint's
 * source order misrepresents. Deliberately not reset per test: vitest
 * evaluates a mock factory once, so only the first boot in the file produces
 * the module-evaluation entry, and the assertion is written to hold whichever
 * test ran first.
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

      // index.ts reads as though config() precedes `import { runCli } from
      // "./daemon/dispatch"`, but ES module semantics (and esbuild's bundling)
      // hoist every static import above the module body. dispatch's
      // MODULE-LEVEL side effects therefore run FIRST; only its function
      // bodies see the loaded .env. Pinned here so the entrypoint's comment
      // and reality cannot drift apart again.
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
 * Static-import graph reachable from src/cli/index.ts.
 *
 * Source-level rather than runtime: the shipped CLI is a single tsup bundle
 * with `splitting: false`, so a require-hook (scripts/startup-require-hook.cjs)
 * can only observe the EXTERNAL deps — it cannot see an in-bundle module being
 * pulled onto the boot path, which is exactly the regression that matters.
 * Reading the imports is what catches it, and it needs no build to run.
 */
// `__dirname`, not `import.meta.url`: this package type-checks against a
// CommonJS target, where `import.meta` is a compile error (TS1470). The
// sibling feature-map-drift suite resolves paths the same way.
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
 * Top-level static imports only. `import type` is skipped (erased at compile
 * time); dynamic `import()` is skipped by construction because the pattern is
 * anchored to the start of a line. `[^;]*?` keeps the optional `… from` clause
 * from running past a side-effect import (`import "./compileCache";`) and
 * stealing the next statement's specifier.
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
    local: [...local].map((f) => relative(SRC_ROOT, f)).sort(),
    bare: [...bare].sort(),
  };
};

describe("the CLI boot module graph", () => {
  const WHY =
    "The CLI's ~30ms cold start depends on this graph staying tiny: everything else " +
    "is reached through lazy import(). If you added a top-level import to a module on " +
    "the boot path, move it to a lazy import() inside the function that needs it. " +
    "If the new module genuinely belongs at boot, update this list deliberately.";

  describe("given the entrypoint's transitive static imports", () => {
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
        "internal/runtime.ts",
      ]);
    });

    it("loads no third-party package at boot except dotenv", () => {
      const { bare } = collectBootGraph();
      const thirdParty = bare.filter(
        (spec) => !spec.startsWith("node:") && !spec.endsWith(".json"),
      );

      expect(
        thirdParty,
        `A third-party package reached the boot path. ${WHY}`,
      ).toEqual(["dotenv"]);
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
        "@langwatch/langy/cards",
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
